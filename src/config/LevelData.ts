export type ObjectiveType = 'delivery' | 'timed';

export interface LevelObjective {
  id: string;
  type: ObjectiveType;
  description: string;
  targetStationId?: string;
  passengerCount?: number;
  timeLimitSecs?: number;
  scoreReward: number;
}

export interface StationDef {
  id: string;
  name: string;
  trackSectionIndex: number;
  trackT: number;
  passengerSpawnRate: number;
}

export interface LevelDef {
  id: string;
  name: string;
  description: string;
  locked: boolean;
  stations: StationDef[];
  objectives: LevelObjective[];
  seed: string;
}

export const LEVELS: LevelDef[] = [
  {
    id: 'level_01',
    name: 'First Run',
    description: 'Learn to drive a train along a simple route.',
    locked: false,
    seed: 'seed-001',
    stations: [
      { id: 'st_central', name: 'Central', trackSectionIndex: 0, trackT: 0.0, passengerSpawnRate: 0.5 },
      { id: 'st_north', name: 'North Gate', trackSectionIndex: 3, trackT: 1.0, passengerSpawnRate: 0.3 },
    ],
    objectives: [
      { id: 'obj_01', type: 'delivery', description: 'Deliver 10 passengers to North Gate', targetStationId: 'st_north', passengerCount: 10, scoreReward: 500 },
    ],
  },
  {
    id: 'level_02',
    name: 'Rush Hour',
    description: 'Manage junctions under pressure.',
    locked: true,
    seed: 'seed-002',
    stations: [
      { id: 'st_central', name: 'Central', trackSectionIndex: 0, trackT: 0.0, passengerSpawnRate: 0.8 },
      { id: 'st_east', name: 'East End', trackSectionIndex: 2, trackT: 1.0, passengerSpawnRate: 0.4 },
      { id: 'st_west', name: 'West Side', trackSectionIndex: 2, trackT: 1.0, passengerSpawnRate: 0.4 },
    ],
    objectives: [
      { id: 'obj_01', type: 'timed', description: 'Deliver 20 passengers in 5 minutes', passengerCount: 20, timeLimitSecs: 300, scoreReward: 1000 },
    ],
  },
];
