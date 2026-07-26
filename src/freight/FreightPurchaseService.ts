import type Train from '../entities/Train';
import type {
  TrackDef,
  TrainDef,
} from '../config/WorldData';
import type { TrackTopologySnapshot } from '../managers/TrackManager';
import { WorldManager } from '../managers/WorldManager';
import { postLedgerEntry } from '../economy/FinanceLedger';
import {
  TIMBER_FREIGHT_SET_ID,
  TIMBER_TRAIN_PURCHASE_PRICE,
} from './FreightSetCatalog';
import { queryRailAccessConnectivity } from './RailAccessConnectivity';

export type FreightPurchaseBlocker =
  | 'no-track'
  | 'outside-forest-access'
  | 'disconnected-route'
  | 'insufficient-cash'
  | 'duplicate-gesture'
  | 'duplicate-train-id'
  | 'stale-revision'
  | 'live-spawn-failed'
  | 'live-placement-failed'
  | 'world-install-failed';

export interface FreightPurchaseQuote {
  readonly expectedRevision: number;
  readonly freightSetId: 'timber-freight-set';
  readonly trackUUID: string;
  readonly trackT: number;
  readonly facing: 1 | -1;
  readonly purchasePrice: 90_000;
  readonly cashAfter: number;
  readonly affordable: boolean;
  readonly valid: boolean;
  readonly blocker: FreightPurchaseBlocker | null;
}

export type FreightPurchaseResult =
  | {
    ok: true;
    trainId: string;
    saved: boolean;
    saveState: 'saved' | 'unsaved';
  }
  | { ok: false; blocker: FreightPurchaseBlocker };

export interface FreightPurchaseRuntimePort {
  spawn(trainId: string, freightSetId: string): Train | null;
  place(
    train: Train,
    trackUUID: string,
    trackT: number,
    facing: 1 | -1,
  ): boolean;
  remove(trainId: string): void;
}

export interface FreightPurchaseQuoteInput {
  readonly freightSetId: 'timber-freight-set';
  readonly trackUUID: string;
  readonly trackT: number;
  readonly x: number;
  readonly y: number;
  readonly topology: TrackTopologySnapshot;
}

type FreightPurchaseWorldPort = Pick<
  typeof WorldManager,
  'world' | 'applyOperationsBatch' | 'save'
>;

const failure = (
  blocker: FreightPurchaseBlocker,
): FreightPurchaseResult => Object.freeze({ ok: false, blocker });

const pointInside = (
  point: Readonly<{ x: number; y: number }>,
  ring: Readonly<{ x: number; y: number; radius: number }>,
): boolean => Math.hypot(point.x - ring.x, point.y - ring.y) <= ring.radius;

const bezierPoint = (
  track: TrackDef,
  t: number,
): { x: number; y: number } => {
  const inverse = 1 - t;
  const p0Weight = inverse * inverse * inverse;
  const p1Weight = 3 * inverse * inverse * t;
  const p2Weight = 3 * inverse * t * t;
  const p3Weight = t * t * t;
  return {
    x: track.p0.x * p0Weight
      + track.p1.x * p1Weight
      + track.p2.x * p2Weight
      + track.p3.x * p3Weight,
    y: track.p0.y * p0Weight
      + track.p1.y * p1Weight
      + track.p2.y * p2Weight
      + track.p3.y * p3Weight,
  };
};

const normalizedDotToward = (
  from: Readonly<{ x: number; y: number }>,
  tangent: Readonly<{ x: number; y: number }>,
  destination: Readonly<{ x: number; y: number }>,
): number => {
  const tangentLength = Math.hypot(tangent.x, tangent.y);
  const destinationX = destination.x - from.x;
  const destinationY = destination.y - from.y;
  const destinationLength = Math.hypot(destinationX, destinationY);
  if (tangentLength === 0 || destinationLength === 0) return 0;
  return (
    tangent.x * destinationX + tangent.y * destinationY
  ) / (tangentLength * destinationLength);
};

const facingFromForestEndpoint = (
  track: TrackDef,
  forest: Readonly<{ x: number; y: number; radius: number }>,
  sawmill: Readonly<{ x: number; y: number }>,
): 1 | -1 => {
  const p0Inside = pointInside(track.p0, forest);
  const p3Inside = pointInside(track.p3, forest);
  if (p0Inside && !p3Inside) return 1;
  if (p3Inside && !p0Inside) return -1;

  const p0Score = normalizedDotToward(
    track.p0,
    {
      x: track.p1.x - track.p0.x,
      y: track.p1.y - track.p0.y,
    },
    sawmill,
  );
  const p3Score = normalizedDotToward(
    track.p3,
    {
      x: track.p2.x - track.p3.x,
      y: track.p2.y - track.p3.y,
    },
    sawmill,
  );
  return p0Score >= p3Score ? 1 : -1;
};

const createPurchasedTrainDef = (
  trainId: string,
  quote: FreightPurchaseQuote,
): TrainDef => ({
  id: trainId,
  freightSetId: TIMBER_FREIGHT_SET_ID,
  trackUUID: quote.trackUUID,
  trackT: quote.trackT,
  facing: quote.facing,
  cargo: null,
  operations: {
    currentTripRevenue: 0,
    currentTripRunningCost: 0,
    lastTripRevenue: 0,
    lastTripRunningCost: 0,
    lifetimeDeliveredUnits: 0,
    lifetimeRevenue: 0,
    lifetimeRunningCost: 0,
  },
});

export class FreightPurchaseService {
  private purchaseInFlight = false;
  private readonly issuedQuotes = new WeakSet<FreightPurchaseQuote>();
  private readonly consumedQuotes = new WeakSet<FreightPurchaseQuote>();

  constructor(
    private readonly worldPort: FreightPurchaseWorldPort,
    private readonly runtimePort: FreightPurchaseRuntimePort,
    private readonly idFactory: () => string = () => crypto.randomUUID(),
  ) {}

  quote(input: FreightPurchaseQuoteInput): FreightPurchaseQuote {
    const world = this.worldPort.world;
    const cash = world?.company.cash ?? 0;
    const cashAfter = cash - TIMBER_TRAIN_PURCHASE_PRICE;
    const affordable = cash >= TIMBER_TRAIN_PURCHASE_PRICE;
    const selectedTrack = world?.tracks.find(
      ({ uuid }) => uuid === input.trackUUID,
    );
    const forest = world?.economy.facilities.find(
      ({ definitionId }) => definitionId === 'managed-forest',
    );
    const sawmill = world?.economy.facilities.find(
      ({ definitionId }) => definitionId === 'sawmill',
    );
    const validTrackPoint = !!selectedTrack
      && Number.isFinite(input.trackT)
      && input.trackT >= 0
      && input.trackT <= 1
      && Number.isFinite(input.x)
      && Number.isFinite(input.y)
      && (() => {
        const expectedPoint = bezierPoint(selectedTrack, input.trackT);
        return Math.hypot(
          expectedPoint.x - input.x,
          expectedPoint.y - input.y,
        ) <= 0.001;
      })();
    const centreInsideForest = !!forest
      && validTrackPoint
      && pointInside({ x: input.x, y: input.y }, forest.railAccess);

    let routeConnected = false;
    if (world && forest && sawmill && selectedTrack && centreInsideForest) {
      const connectivity = queryRailAccessConnectivity(
        world.tracks,
        input.topology,
        { facilityId: forest.id, ...forest.railAccess },
        { facilityId: sawmill.id, ...sawmill.railAccess },
      );
      routeConnected = connectivity.sourceEndpointTrackUUIDs.indexOf(
        selectedTrack.uuid,
      ) !== -1 && connectivity.connectedTrackUUIDs.indexOf(
        selectedTrack.uuid,
      ) !== -1;
    }

    let blocker: FreightPurchaseBlocker | null = null;
    if (this.purchaseInFlight) blocker = 'duplicate-gesture';
    else if (!world) blocker = 'stale-revision';
    else if (!validTrackPoint) blocker = 'no-track';
    else if (!centreInsideForest) blocker = 'outside-forest-access';
    else if (!routeConnected || !forest || !sawmill) {
      blocker = 'disconnected-route';
    } else if (!affordable) blocker = 'insufficient-cash';

    const facing = selectedTrack && forest && sawmill
      ? facingFromForestEndpoint(
        selectedTrack,
        forest.railAccess,
        sawmill.railAccess,
      )
      : 1;
    const quote: FreightPurchaseQuote = Object.freeze({
      expectedRevision: world?.revision ?? -1,
      freightSetId: TIMBER_FREIGHT_SET_ID,
      trackUUID: String(input.trackUUID),
      trackT: input.trackT,
      facing,
      purchasePrice: TIMBER_TRAIN_PURCHASE_PRICE,
      cashAfter,
      affordable,
      valid: blocker === null,
      blocker,
    });
    this.issuedQuotes.add(quote);
    return quote;
  }

  purchase(quote: FreightPurchaseQuote): FreightPurchaseResult {
    if (this.purchaseInFlight) return failure('duplicate-gesture');
    this.purchaseInFlight = true;
    try {
      const world = this.worldPort.world;
      if (!world
        || !this.issuedQuotes.has(quote)
        || this.consumedQuotes.has(quote)
        || world.revision !== quote.expectedRevision) {
        return failure('stale-revision');
      }
      this.consumedQuotes.add(quote);
      if (!quote.valid || quote.blocker !== null) {
        return failure(quote.blocker ?? 'world-install-failed');
      }

      let trainId: string;
      try {
        trainId = this.idFactory();
      } catch {
        return failure('live-spawn-failed');
      }
      if (world.trains.some(({ id }) => id === trainId)) {
        return failure('duplicate-train-id');
      }

      let train: Train | null;
      try {
        train = this.runtimePort.spawn(trainId, quote.freightSetId);
      } catch {
        this.removeProvisional(trainId);
        return failure('live-spawn-failed');
      }
      if (!train) {
        this.removeProvisional(trainId);
        return failure('live-spawn-failed');
      }

      let placed = false;
      try {
        placed = this.runtimePort.place(
          train,
          quote.trackUUID,
          quote.trackT,
          quote.facing,
        );
      } catch {
        placed = false;
      }
      if (!placed) {
        this.removeProvisional(trainId);
        return failure('live-placement-failed');
      }

      let committed = false;
      try {
        committed = this.worldPort.applyOperationsBatch(
          quote.expectedRevision,
          (draft) => {
            if (draft.trains.some(({ id }) => id === trainId)) return false;
            const posted = postLedgerEntry(draft.company, {
              magnitude: TIMBER_TRAIN_PURCHASE_PRICE,
              category: 'vehicle-capex',
              tick: draft.economy.tick,
              referenceId: trainId,
              direction: 'forward',
            });
            if (!posted.ok) return false;
            draft.company = posted.company;
            draft.trains.push(createPurchasedTrainDef(trainId, quote));
            return true;
          },
        );
      } catch {
        committed = false;
      }
      if (!committed) {
        this.removeProvisional(trainId);
        return failure(
          this.worldPort.world?.revision !== quote.expectedRevision
            ? 'stale-revision'
            : 'world-install-failed',
        );
      }

      let saved = false;
      try {
        saved = this.worldPort.save();
      } catch {
        saved = false;
      }
      return Object.freeze({
        ok: true,
        trainId,
        saved,
        saveState: saved ? 'saved' : 'unsaved',
      });
    } finally {
      this.purchaseInFlight = false;
    }
  }

  private removeProvisional(trainId: string): void {
    try {
      this.runtimePort.remove(trainId);
    } catch {
      // The authoritative batch still remains untouched on rollback.
    }
  }
}
