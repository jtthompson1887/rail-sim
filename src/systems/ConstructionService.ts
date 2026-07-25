import Phaser from 'phaser';
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
  type ConstructionProposal,
} from './ConstructionAnalyzer';
import {
  deriveAutomaticCubic,
  type TrackGeometryDef,
} from './TrackGeometry';

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
  readonly worldRevision: number;
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
    const world = WorldManager.world;
    if (!world || !WorldManager.canAdvanceRevision()
      || !newTrackUUID || this.trackManager.getTrack(newTrackUUID)
      || world.tracks.some((track) => track.uuid === newTrackUUID)) return null;

    const startSnap = this.trackManager.findEndpointNear(
      new Phaser.Math.Vector2(start.x, start.y),
      GameConfig.TRACK.SNAP_RADIUS_PX,
    );
    const endSnap = this.trackManager.findEndpointNear(
      new Phaser.Math.Vector2(end.x, end.y),
      GameConfig.TRACK.SNAP_RADIUS_PX,
    );
    if ((startSnap && this.trackManager.endpointHasConnection(startSnap.track, startSnap.isStart))
      || (endSnap && this.trackManager.endpointHasConnection(endSnap.track, endSnap.isStart))) {
      return null;
    }
    if (startSnap && endSnap
      && startSnap.track === endSnap.track
      && startSnap.isStart === endSnap.isStart) return null;

    const snappedStart = startSnap
      ? startSnap.track.getCurvePath()[startSnap.isStart ? 'getStartPoint' : 'getEndPoint']()
      : start;
    const snappedEnd = endSnap
      ? endSnap.track.getCurvePath()[endSnap.isStart ? 'getStartPoint' : 'getEndPoint']()
      : end;
    const geometry = deriveAutomaticCubic({
      start: { x: snappedStart.x, y: snappedStart.y },
      end: { x: snappedEnd.x, y: snappedEnd.y },
      startOutward: startSnap
        ? { x: startSnap.tangent.x, y: startSnap.tangent.y }
        : undefined,
      endOutward: endSnap
        ? { x: endSnap.tangent.x, y: endSnap.tangent.y }
        : undefined,
    });
    const analyzed = this.safeAnalyze(geometry);
    if (!analyzed?.valid) return null;

    const predictedConnections: PredictedEndpointConnectionDef[] = [];
    if (startSnap) {
      predictedConnections.push({
        kind: 'endpoint-connection',
        existingTrackUUID: startSnap.track.getUUID(),
        existingEndpoint: startSnap.isStart ? 'start' : 'end',
        newEndpoint: 'start',
        point: { ...geometry.p0 },
      });
    }
    if (endSnap) {
      predictedConnections.push({
        kind: 'endpoint-connection',
        existingTrackUUID: endSnap.track.getUUID(),
        existingEndpoint: endSnap.isStart ? 'start' : 'end',
        newEndpoint: 'end',
        point: { ...geometry.p3 },
      });
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
    const totalCost = analyzed.costs.total + topologyCost;
    if (!Number.isSafeInteger(totalCost) || totalCost <= 0) return null;

    const quote = deepFreeze({
      quoteId: crypto.randomUUID(),
      newTrackUUID,
      worldRevision: world.revision,
      expectedCash: world.company.cash,
      proposal: clonePlainData(analyzed),
      expectedAffectedTracks,
      predictedConnections,
      topologyCost,
      totalCost,
    });
    this.quoteWorlds.set(quote, world);
    return quote;
  }

  revalidateQuote(quote: ConstructionQuote): boolean {
    return this.validateQuoteState(quote, true, quote.expectedCash);
  }

  revalidateQuoteForRedo(quote: ConstructionQuote, expectedCash: number): boolean {
    return this.validateQuoteState(quote, false, expectedCash);
  }

  private validateQuoteState(
    quote: ConstructionQuote,
    requireCapturedRevision: boolean,
    expectedCash: number,
  ): boolean {
    const world = WorldManager.world;
    if (!world || this.quoteWorlds.get(quote) !== world
      || !WorldManager.canAdvanceRevision()
      || (requireCapturedRevision && world.revision !== quote.worldRevision)
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

    const analyzed = this.safeAnalyze(quote.proposal.geometry);
    return analyzed !== null && analyzed.valid && exact(analyzed, quote.proposal);
  }

  private safeAnalyze(geometry: TrackGeometryDef): ConstructionProposal | null {
    try {
      return this.analyzer.analyze(geometry);
    } catch {
      return null;
    }
  }
}
