import type Train from '../entities/Train';
import type {
  TrackDef,
  TrainDef,
} from '../config/WorldData';
import type { TrackTopologySnapshot } from '../managers/TrackManager';
import { WorldManager } from '../managers/WorldManager';
import { postLedgerEntry } from '../economy/FinanceLedger';
import {
  AGGREGATE_HOPPER_SET_ID,
  COVERED_CEMENT_SET_ID,
  FLATBED_FREIGHT_SET_ID,
  getFreightSet,
} from './FreightSetCatalog';
import {
  potentialAcceptedProduct,
  potentialLoadProducts,
} from './FacilityCargoRules';
import { queryRailAccessConnectivity } from './RailAccessConnectivity';

export type FreightPurchaseBlocker =
  | 'unknown-freight-set'
  | 'route-unavailable'
  | 'no-track'
  | 'outside-source-access'
  | 'disconnected-route'
  | 'insufficient-cash'
  | 'duplicate-gesture'
  | 'duplicate-train-id'
  | 'stale-revision'
  | 'live-spawn-failed'
  | 'live-placement-failed'
  | 'live-rollback-failed'
  | 'world-install-failed';

export interface FreightPurchaseQuote {
  readonly expectedRevision: number;
  readonly freightSetId: string;
  readonly trackUUID: string;
  readonly trackT: number;
  readonly facing: 1 | -1;
  readonly purchasePrice: number;
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
  remove(trainId: string): boolean | void;
}

export interface FreightPurchaseQuoteInput {
  readonly freightSetId: string;
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

export type FreightPurchaseSetId =
  | typeof FLATBED_FREIGHT_SET_ID
  | typeof AGGREGATE_HOPPER_SET_ID
  | typeof COVERED_CEMENT_SET_ID;

export interface FreightPurchaseRoutePolicy {
  readonly freightSetId: FreightPurchaseSetId;
  readonly productId: string;
  readonly sourceDefinitionId: string;
  readonly destinationDefinitionId: string;
}

const FREIGHT_PURCHASE_ROUTE_POLICIES:
readonly FreightPurchaseRoutePolicy[] = Object.freeze([
  Object.freeze({
    freightSetId: FLATBED_FREIGHT_SET_ID,
    productId: 'logs',
    sourceDefinitionId: 'managed-forest',
    destinationDefinitionId: 'sawmill',
  }),
  Object.freeze({
    freightSetId: AGGREGATE_HOPPER_SET_ID,
    productId: 'limestone-aggregate',
    sourceDefinitionId: 'quarry',
    destinationDefinitionId: 'cement-works',
  }),
  Object.freeze({
    freightSetId: COVERED_CEMENT_SET_ID,
    productId: 'cement',
    sourceDefinitionId: 'cement-works',
    destinationDefinitionId: 'prefabrication-plant',
  }),
]);

const routePolicyByFreightSetId =
  new Map<string, FreightPurchaseRoutePolicy>(
  FREIGHT_PURCHASE_ROUTE_POLICIES.map((policy) => [
    policy.freightSetId,
    policy,
  ]),
);

export const getFreightPurchaseRoutePolicy = (
  freightSetId: string,
): FreightPurchaseRoutePolicy | undefined =>
  routePolicyByFreightSetId.get(freightSetId);

interface IssuedQuoteContext {
  readonly topology: TrackTopologySnapshot;
  readonly sourceFacilityId: string;
  readonly destinationFacilityId: string;
}

const detachTopology = (
  topology: TrackTopologySnapshot,
): TrackTopologySnapshot => Object.freeze(topology.map((candidate) =>
  Object.freeze({
    kind: candidate.kind,
    uuid: String(candidate.uuid),
    previous: candidate.previous
      ? Object.freeze({
        kind: candidate.previous.kind,
        uuid: String(candidate.previous.uuid),
      })
      : null,
    next: candidate.next
      ? Object.freeze({
        kind: candidate.next.kind,
        uuid: String(candidate.next.uuid),
      })
      : null,
  }))) as unknown as TrackTopologySnapshot;

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

const facingFromSourceEndpoint = (
  track: TrackDef,
  source: Readonly<{ x: number; y: number; radius: number }>,
  destination: Readonly<{ x: number; y: number }>,
): 1 | -1 => {
  const p0Inside = pointInside(track.p0, source);
  const p3Inside = pointInside(track.p3, source);
  if (p0Inside && !p3Inside) return 1;
  if (p3Inside && !p0Inside) return -1;

  const p0Score = normalizedDotToward(
    track.p0,
    {
      x: track.p1.x - track.p0.x,
      y: track.p1.y - track.p0.y,
    },
    destination,
  );
  const p3Score = normalizedDotToward(
    track.p3,
    {
      x: track.p2.x - track.p3.x,
      y: track.p2.y - track.p3.y,
    },
    destination,
  );
  return p0Score >= p3Score ? 1 : -1;
};

const createPurchasedTrainDef = (
  trainId: string,
  quote: FreightPurchaseQuote,
): TrainDef => ({
  id: trainId,
  freightSetId: quote.freightSetId,
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
  private readonly issuedQuoteContexts =
    new WeakMap<FreightPurchaseQuote, IssuedQuoteContext>();

  constructor(
    private readonly worldPort: FreightPurchaseWorldPort,
    private readonly runtimePort: FreightPurchaseRuntimePort,
    private readonly idFactory: () => string = () => crypto.randomUUID(),
  ) {}

  quote(input: FreightPurchaseQuoteInput): FreightPurchaseQuote {
    const world = this.worldPort.world;
    const cash = world?.company.cash ?? 0;
    const freightSet = getFreightSet(input.freightSetId);
    const policy = getFreightPurchaseRoutePolicy(input.freightSetId);
    const purchasePrice = freightSet?.purchasePrice ?? 0;
    const cashAfter = cash - purchasePrice;
    const affordable = freightSet !== undefined
      && cash >= purchasePrice;
    const selectedTrack = world?.tracks.find(
      ({ uuid }) => uuid === input.trackUUID,
    );
    const source = world?.economy.facilities.find(
      ({ definitionId }) => definitionId === policy?.sourceDefinitionId,
    );
    const destination = world?.economy.facilities.find(
      ({ definitionId }) => definitionId === policy?.destinationDefinitionId,
    );
    const routeAvailable = !!freightSet
      && !!policy
      && !!source
      && !!destination
      && potentialLoadProducts(source, freightSet).some(
        ({ productId }) => productId === policy.productId,
      )
      && potentialAcceptedProduct(destination, policy.productId) !== null;
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
    const centreInsideSource = !!source
      && validTrackPoint
      && pointInside({ x: input.x, y: input.y }, source.railAccess);

    let routeConnected = false;
    if (world
      && source
      && destination
      && selectedTrack
      && centreInsideSource) {
      const connectivity = queryRailAccessConnectivity(
        world.tracks,
        input.topology,
        { facilityId: source.id, ...source.railAccess },
        { facilityId: destination.id, ...destination.railAccess },
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
    else if (!freightSet || !policy) blocker = 'unknown-freight-set';
    else if (!routeAvailable) blocker = 'route-unavailable';
    else if (!validTrackPoint) blocker = 'no-track';
    else if (!centreInsideSource) blocker = 'outside-source-access';
    else if (!routeConnected) {
      blocker = 'disconnected-route';
    } else if (!affordable) blocker = 'insufficient-cash';

    const facing = selectedTrack && source && destination
      ? facingFromSourceEndpoint(
        selectedTrack,
        source.railAccess,
        destination.railAccess,
      )
      : 1;
    const quote: FreightPurchaseQuote = Object.freeze({
      expectedRevision: world?.revision ?? -1,
      freightSetId: String(input.freightSetId),
      trackUUID: String(input.trackUUID),
      trackT: input.trackT,
      facing,
      purchasePrice,
      cashAfter,
      affordable,
      valid: blocker === null,
      blocker,
    });
    this.issuedQuotes.add(quote);
    if (source && destination) {
      this.issuedQuoteContexts.set(quote, Object.freeze({
        topology: detachTopology(input.topology),
        sourceFacilityId: source.id,
        destinationFacilityId: destination.id,
      }));
    }
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
      const freightSet = getFreightSet(quote.freightSetId);
      const policy = getFreightPurchaseRoutePolicy(quote.freightSetId);
      if (!freightSet || !policy) return failure('unknown-freight-set');

      const context = this.issuedQuoteContexts.get(quote);
      const source = world.economy.facilities.find(
        ({ id, definitionId }) =>
          id === context?.sourceFacilityId
          && definitionId === policy.sourceDefinitionId,
      );
      const destination = world.economy.facilities.find(
        ({ id, definitionId }) =>
          id === context?.destinationFacilityId
          && definitionId === policy.destinationDefinitionId,
      );
      const selectedTrack = world.tracks.find(
        ({ uuid }) => uuid === quote.trackUUID,
      );
      const routeCargoAvailable = !!source
        && !!destination
        && potentialLoadProducts(source, freightSet).some(
          ({ productId }) => productId === policy.productId,
        )
        && potentialAcceptedProduct(destination, policy.productId) !== null;
      const placementPoint = selectedTrack
        ? bezierPoint(selectedTrack, quote.trackT)
        : null;
      const sourceStillContainsPlacement = !!source
        && !!placementPoint
        && pointInside(placementPoint, source.railAccess);
      let routeStillConnected = false;
      if (context
        && source
        && destination
        && selectedTrack
        && sourceStillContainsPlacement) {
        const connectivity = queryRailAccessConnectivity(
          world.tracks,
          context.topology,
          { facilityId: source.id, ...source.railAccess },
          { facilityId: destination.id, ...destination.railAccess },
        );
        routeStillConnected = connectivity.sourceEndpointTrackUUIDs.indexOf(
          selectedTrack.uuid,
        ) !== -1 && connectivity.connectedTrackUUIDs.indexOf(
          selectedTrack.uuid,
        ) !== -1;
      }
      if (!context
        || !routeCargoAvailable
        || !sourceStillContainsPlacement
        || !routeStillConnected) {
        return failure('route-unavailable');
      }
      if (world.company.cash < freightSet.purchasePrice) {
        return failure('insufficient-cash');
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
        return failure(
          this.removeProvisional(trainId) === 'removed'
            ? 'live-spawn-failed'
            : 'live-rollback-failed',
        );
      }
      if (!train) {
        return failure(
          this.removeProvisional(trainId) === 'removed'
            ? 'live-spawn-failed'
            : 'live-rollback-failed',
        );
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
        return failure(
          this.removeProvisional(trainId) === 'removed'
            ? 'live-placement-failed'
            : 'live-rollback-failed',
        );
      }

      let committed = false;
      try {
        committed = this.worldPort.applyOperationsBatch(
          quote.expectedRevision,
          (draft) => {
            if (draft.trains.some(({ id }) => id === trainId)) return false;
            const posted = postLedgerEntry(draft.company, {
              magnitude: quote.purchasePrice,
              category: 'vehicle-capex',
              tick: draft.economy.tick,
              referenceId: quote.freightSetId,
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
        if (this.removeProvisional(trainId) !== 'removed') {
          return failure('live-rollback-failed');
        }
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

  private removeProvisional(
    trainId: string,
  ): 'removed' | 'rejected' | 'threw' {
    try {
      return this.runtimePort.remove(trainId) === false
        ? 'rejected'
        : 'removed';
    } catch {
      return 'threw';
    }
  }
}
