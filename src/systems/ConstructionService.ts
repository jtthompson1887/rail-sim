import { ENDPOINT_CONNECTION_COST } from '../config/ConstructionConfig';
import { GameConfig } from '../config/GameConfig';
import type { Vec2Def } from '../config/WorldData';
import type { WorldData } from '../config/WorldData';
import TrackManager from '../managers/TrackManager';
import { WorldManager } from '../managers/WorldManager';
import { TrackSerializer } from '../utils/TrackSerializer';
import { clonePlainData, equalPlainData } from '../utils/PlainData';
import {
  ConstructionAnalyzer,
  type ConstructionAnalysisDetail,
  type ConstructionProposal,
} from './ConstructionAnalyzer';
import { sampleConstructionCurve } from './ConstructionCurveSampler';
import {
  hasConstructionClearance,
  type ClearanceTrack,
} from './TrackClearance';
import {
  deriveAutomaticCubic,
  type TrackGeometryDef,
} from './TrackGeometry';
import {
  resolveTrackEndpoint,
  type ResolvedTrackEndpoint,
} from './SnapSystem';

export type TrackEndpoint = 'start' | 'end';

export interface PredictedEndpointConnectionDef {
  readonly kind: 'endpoint-connection';
  readonly existingTrackUUID: string;
  readonly existingEndpoint: TrackEndpoint;
  readonly newEndpoint: TrackEndpoint;
  readonly point: Readonly<Vec2Def>;
}

export interface ConstructionQuote {
  readonly quoteId: string;
  readonly newTrackUUID: string;
  readonly rootRevision: number;
  readonly constructionRevision: number;
  readonly expectedCash: number;
  readonly proposal: ConstructionProposal;
  readonly expectedAffectedTracks: ReadonlyArray<{
    readonly trackUUID: string;
    readonly geometry: TrackGeometryDef;
  }>;
  readonly predictedConnections: ReadonlyArray<PredictedEndpointConnectionDef>;
  readonly topologyCost: number;
  readonly totalCost: number;
}

export type ConstructionPreviewStatus =
  | 'committable'
  | 'engineering-invalid'
  | 'endpoint-unavailable'
  | 'unaffordable';

export interface ConstructionPreviewAnchor {
  readonly x: number;
  readonly y: number;
  readonly endpoint: ResolvedTrackEndpoint | null;
}

export interface LegacyConstructionInputAnchor extends Vec2Def {
  readonly snapped?: undefined;
  readonly type?: undefined;
}

export interface FreeConstructionInputAnchor extends Vec2Def {
  readonly snapped: false;
  readonly type: 'none';
}

export interface GridConstructionInputAnchor extends Vec2Def {
  readonly snapped: true;
  readonly type: 'grid';
}

export interface EndpointConstructionInputAnchor extends Vec2Def {
  readonly snapped: true;
  readonly type: 'endpoint';
  readonly trackUUID: string;
  readonly endpoint: 'start' | 'end';
  readonly outward: Readonly<Vec2Def>;
  readonly open: boolean;
}

export type ConstructionInputAnchor =
  | LegacyConstructionInputAnchor
  | FreeConstructionInputAnchor
  | GridConstructionInputAnchor
  | EndpointConstructionInputAnchor;

/**
 * One immutable analysis result for one semantic pointer position. A valid,
 * affordable result owns the exact quote object later handed to the command.
 */
export interface ConstructionPreview {
  readonly status: ConstructionPreviewStatus;
  readonly startAnchor: ConstructionPreviewAnchor;
  readonly endAnchor: ConstructionPreviewAnchor;
  readonly proposal: ConstructionProposal;
  readonly quote: ConstructionQuote | null;
  readonly predictedConnections: ReadonlyArray<PredictedEndpointConnectionDef>;
  readonly topologyCost: number;
  readonly totalCost: number;
  readonly cashBefore: number;
  readonly cashAfter: number;
  readonly affordable: boolean;
  readonly message: string;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      deepFreeze(record[key]);
    }
  }
  return value;
}

function exact(left: unknown, right: unknown): boolean {
  return equalPlainData(left, right);
}

function geometryOf(trackUUID: string, trackManager: TrackManager): TrackGeometryDef | null {
  const track = trackManager.getTrack(trackUUID);
  if (!track) return null;
  try {
    const def = TrackSerializer.toTrackDef(track);
    return {
      geometryVersion: 1,
      p0: { ...def.p0 },
      p1: { ...def.p1 },
      p2: { ...def.p2 },
      p3: { ...def.p3 },
    };
  } catch {
    return null;
  }
}

/**
 * Produces immutable, fully priced construction quotes and revalidates them
 * against the authoritative live world immediately before commit.
 */
export class ConstructionService {
  private readonly quoteWorlds = new WeakMap<ConstructionQuote, WorldData>();

  constructor(
    private readonly trackManager: TrackManager,
    private readonly analyzer: ConstructionAnalyzer,
  ) {}

  createQuote(
    start: Vec2Def,
    end: Vec2Def,
    newTrackUUID: string = crypto.randomUUID(),
  ): ConstructionQuote | null {
    return this.createPreview(start, end, newTrackUUID)?.quote ?? null;
  }

  createPreview(
    start: ConstructionInputAnchor,
    end: ConstructionInputAnchor,
    newTrackUUID: string = crypto.randomUUID(),
  ): ConstructionPreview | null {
    const world = WorldManager.world;
    if (!world || !WorldManager.canAdvanceRevision()
      || !this.liveTracksMatchWorld(world)
      || !newTrackUUID || this.trackManager.getTrack(newTrackUUID)
      || world.tracks.some((track) => track.uuid === newTrackUUID)
      || !this.isSupportedAnchor(start)
      || !this.isSupportedAnchor(end)) return null;

    const startSnap = this.resolveInputEndpoint(start);
    const endSnap = this.resolveInputEndpoint(end);
    const startEndpointStale = start.type === 'endpoint' && !startSnap;
    const endEndpointStale = end.type === 'endpoint' && !endSnap;
    const sameResolvedEndpoint = !!(startSnap && endSnap
      && startSnap.trackUUID === endSnap.trackUUID
      && startSnap.endpoint === endSnap.endpoint);

    const snappedStart = startSnap
      ? startSnap
      : start;
    const snappedEnd = endSnap
      ? endSnap
      : end;
    const geometry = deriveAutomaticCubic({
      start: { x: snappedStart.x, y: snappedStart.y },
      end: { x: snappedEnd.x, y: snappedEnd.y },
      startOutward: startSnap
        ? { ...startSnap.outward }
        : undefined,
      endOutward: endSnap
        ? { ...endSnap.outward }
        : undefined,
    });

    const predictedConnections: PredictedEndpointConnectionDef[] = [];
    if (startSnap) {
      predictedConnections.push({
        kind: 'endpoint-connection',
        existingTrackUUID: startSnap.trackUUID,
        existingEndpoint: startSnap.endpoint,
        newEndpoint: 'start',
        point: { ...geometry.p0 },
      });
    }
    if (endSnap && !sameResolvedEndpoint) {
      predictedConnections.push({
        kind: 'endpoint-connection',
        existingTrackUUID: endSnap.trackUUID,
        existingEndpoint: endSnap.endpoint,
        newEndpoint: 'end',
        point: { ...geometry.p3 },
      });
    }

    const analyzed = this.safeAnalyzeDetailed(geometry);
    if (!analyzed) return null;
    let proposal = clonePlainData(analyzed.proposal);
    if (
      proposal.valid
      && !this.hasClearance(
        geometry,
        analyzed.curveSamples,
        predictedConnections,
      )
    ) {
      proposal = {
        ...proposal,
        valid: false,
        reasonCode: 'clearance',
        remedy: 'Move the route away from existing infrastructure.',
      };
    }

    const affectedIds = Array.from(new Set(
      predictedConnections.map((connection) => connection.existingTrackUUID),
    )).sort();
    const expectedAffectedTracks: ConstructionQuote['expectedAffectedTracks'][number][] = [];
    for (const trackUUID of affectedIds) {
      const affectedGeometry = geometryOf(trackUUID, this.trackManager);
      if (!affectedGeometry) return null;
      expectedAffectedTracks.push({ trackUUID, geometry: affectedGeometry });
    }
    const topologyCost = predictedConnections.length * ENDPOINT_CONNECTION_COST;
    const totalCost = proposal.costs.total + topologyCost;
    if (!Number.isSafeInteger(totalCost) || totalCost < 0) return null;
    const endpointUnavailable = !!(
      (startSnap && !startSnap.open)
      || (endSnap && !endSnap.open)
      || startEndpointStale
      || endEndpointStale
    );
    const affordable = totalCost > 0 && world.company.cash >= totalCost;
    const committable = proposal.valid
      && !endpointUnavailable
      && affordable
      && totalCost > 0;

    let quote: ConstructionQuote | null = null;
    if (committable) {
      quote = deepFreeze({
        quoteId: crypto.randomUUID(),
        newTrackUUID,
        rootRevision: world.revision,
        constructionRevision: world.constructionRevision,
        expectedCash: world.company.cash,
        proposal,
        expectedAffectedTracks,
        predictedConnections,
        topologyCost,
        totalCost,
      });
      this.quoteWorlds.set(quote, world);
    }

    const status: ConstructionPreviewStatus = endpointUnavailable
      ? 'endpoint-unavailable'
      : !proposal.valid
        ? 'engineering-invalid'
        : !affordable
          ? 'unaffordable'
          : 'committable';
    const message = status === 'endpoint-unavailable'
      ? 'That endpoint is already connected — choose an open endpoint.'
      : status === 'engineering-invalid'
        ? proposal.remedy
        : status === 'unaffordable'
          ? 'This section exceeds your available cash.'
          : '';
    return deepFreeze({
      status,
      startAnchor: {
        x: geometry.p0.x,
        y: geometry.p0.y,
        endpoint: startSnap,
      },
      endAnchor: {
        x: geometry.p3.x,
        y: geometry.p3.y,
        endpoint: endSnap,
      },
      proposal,
      quote,
      predictedConnections,
      topologyCost,
      totalCost,
      cashBefore: world.company.cash,
      cashAfter: world.company.cash - totalCost,
      affordable,
      message,
    });
  }

  revalidateQuote(quote: ConstructionQuote): boolean {
    return this.validateQuoteState(
      quote,
      quote.rootRevision,
      quote.constructionRevision,
      quote.expectedCash,
    );
  }

  revalidateQuoteForRedo(
    quote: ConstructionQuote,
    expectedCash: number,
    expectedRootRevision = quote.rootRevision,
    expectedConstructionRevision = quote.constructionRevision,
  ): boolean {
    return this.validateQuoteState(
      quote,
      expectedRootRevision,
      expectedConstructionRevision,
      expectedCash,
    );
  }

  private validateQuoteState(
    quote: ConstructionQuote,
    expectedRootRevision: number,
    expectedConstructionRevision: number,
    expectedCash: number,
  ): boolean {
    const world = WorldManager.world;
    if (!world || this.quoteWorlds.get(quote) !== world
      || !WorldManager.canAdvanceRevision()
      || !this.liveTracksMatchWorld(world)
      || world.revision !== expectedRootRevision
      || world.constructionRevision !== expectedConstructionRevision
      || world.company.cash !== expectedCash
      || !quote.quoteId || !quote.newTrackUUID
      || this.trackManager.getTrack(quote.newTrackUUID)
      || world.tracks.some((track) => track.uuid === quote.newTrackUUID)
      || quote.predictedConnections.length > 2
      || quote.topologyCost
        !== quote.predictedConnections.length * ENDPOINT_CONNECTION_COST
      || quote.totalCost !== quote.proposal.costs.total + quote.topologyCost
      || !Number.isSafeInteger(quote.totalCost)
      || quote.totalCost <= 0
      || world.company.cash < quote.totalCost) return false;

    const newEndpoints = new Set<TrackEndpoint>();
    const existingEndpoints = new Set<string>();
    for (const connection of quote.predictedConnections) {
      const track = this.trackManager.getTrack(connection.existingTrackUUID);
      if (!track || newEndpoints.has(connection.newEndpoint)) return false;
      const endpointKey = `${connection.existingTrackUUID}:${connection.existingEndpoint}`;
      if (existingEndpoints.has(endpointKey)) return false;
      newEndpoints.add(connection.newEndpoint);
      existingEndpoints.add(endpointKey);
      const isStart = connection.existingEndpoint === 'start';
      if (this.trackManager.endpointHasConnection(track, isStart)) return false;
      const point = track.getCurvePath()[isStart ? 'getStartPoint' : 'getEndPoint']();
      const proposalPoint = connection.newEndpoint === 'start'
        ? quote.proposal.geometry.p0
        : quote.proposal.geometry.p3;
      if (!exact(connection.point, { x: point.x, y: point.y })
        || !exact(connection.point, proposalPoint)) return false;
    }

    const affectedIds = Array.from(existingEndpoints)
      .map((endpoint) => endpoint.slice(0, endpoint.lastIndexOf(':')));
    const uniqueAffectedIds = Array.from(new Set(affectedIds)).sort();
    if (quote.expectedAffectedTracks.length !== uniqueAffectedIds.length) return false;
    for (let index = 0; index < uniqueAffectedIds.length; index++) {
      const expected = quote.expectedAffectedTracks[index];
      if (expected.trackUUID !== uniqueAffectedIds[index]
        || !exact(expected.geometry, geometryOf(expected.trackUUID, this.trackManager))) {
        return false;
      }
    }

    const analyzed = this.safeAnalyzeDetailed(quote.proposal.geometry);
    return analyzed !== null
      && analyzed.proposal.valid
      && exact(analyzed.proposal, quote.proposal)
      && this.hasClearance(
        quote.proposal.geometry,
        analyzed.curveSamples,
        quote.predictedConnections,
      );
  }

  private safeAnalyzeDetailed(
    geometry: TrackGeometryDef,
  ): ConstructionAnalysisDetail | null {
    try {
      return this.analyzer.analyzeDetailed(geometry);
    } catch {
      return null;
    }
  }

  private hasClearance(
    geometry: TrackGeometryDef,
    curveSamples: ConstructionAnalysisDetail['curveSamples'],
    predictedConnections: readonly PredictedEndpointConnectionDef[],
  ): boolean {
    const existingTracks: ClearanceTrack[] = [];
    for (const track of [...this.trackManager.getAllTracks()].sort((left, right) => (
      left.getUUID() < right.getUUID()
        ? -1
        : left.getUUID() > right.getUUID() ? 1 : 0
    ))) {
      const existingGeometry = geometryOf(track.getUUID(), this.trackManager);
      if (!existingGeometry) return false;
      const existingProfile = sampleConstructionCurve(existingGeometry);
      if (!existingProfile.ok) return false;
      existingTracks.push({
        trackUUID: track.getUUID(),
        geometry: existingGeometry,
        curveSamples: existingProfile.samples,
      });
    }
    return hasConstructionClearance(
      { geometry, curveSamples },
      existingTracks,
      predictedConnections,
    );
  }

  private liveTracksMatchWorld(world: WorldData): boolean {
    const liveTracks = [...this.trackManager.getAllTracks()].sort((left, right) => (
      left.getUUID() < right.getUUID()
        ? -1
        : left.getUUID() > right.getUUID() ? 1 : 0
    ));
    const persistedTracks = [...world.tracks].sort((left, right) => (
      left.uuid < right.uuid ? -1 : left.uuid > right.uuid ? 1 : 0
    ));
    if (liveTracks.length !== persistedTracks.length) return false;
    try {
      return liveTracks.every((track, index) => (
        equalPlainData(TrackSerializer.toTrackDef(track), persistedTracks[index])
      ));
    } catch {
      return false;
    }
  }

  private resolveInputEndpoint(
    anchor: ConstructionInputAnchor,
  ): ResolvedTrackEndpoint | null {
    if (anchor.type !== undefined && anchor.type !== 'endpoint') return null;
    const resolved = resolveTrackEndpoint(
      this.trackManager,
      anchor.x,
      anchor.y,
      anchor.type === 'endpoint' ? 0 : GameConfig.TRACK.SNAP_RADIUS_PX,
    );
    if (!resolved || anchor.type !== 'endpoint') return resolved;
    const endpointAnchor = anchor as EndpointConstructionInputAnchor;
    return exact(resolved, {
      x: endpointAnchor.x,
      y: endpointAnchor.y,
      trackUUID: endpointAnchor.trackUUID,
      endpoint: endpointAnchor.endpoint,
      outward: endpointAnchor.outward,
      open: endpointAnchor.open,
    })
      ? resolved
      : null;
  }

  private isSupportedAnchor(anchor: ConstructionInputAnchor): boolean {
    if (!anchor || typeof anchor !== 'object'
      || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return false;
    const runtime = anchor as unknown as Record<string, unknown>;
    const hasEndpointMetadata = [
      'trackUUID',
      'endpoint',
      'outward',
      'open',
    ].some((key) => key in runtime);
    if (anchor.type === undefined) {
      return anchor.snapped === undefined && !hasEndpointMetadata;
    }
    if (anchor.type === 'none') {
      return anchor.snapped === false && !hasEndpointMetadata;
    }
    if (anchor.type === 'grid') {
      return anchor.snapped === true && !hasEndpointMetadata;
    }
    return anchor.type === 'endpoint'
      && anchor.snapped === true
      && typeof runtime.trackUUID === 'string'
      && runtime.trackUUID.length > 0
      && (runtime.endpoint === 'start' || runtime.endpoint === 'end')
      && !!runtime.outward
      && typeof runtime.outward === 'object'
      && Number.isFinite((runtime.outward as Vec2Def).x)
      && Number.isFinite((runtime.outward as Vec2Def).y)
      && typeof runtime.open === 'boolean';
  }
}
