import RailTrack from "./track";
import Vector2 = Phaser.Math.Vector2;
import Vector2Like = Phaser.Types.Math.Vector2Like;

export default class TrackManager {
    private tracks: Map<string, RailTrack>;
    private scene: Phaser.Scene;
    private visibleTracks: Set<string>;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.tracks = new Map<string, RailTrack>();
        this.visibleTracks = new Set<string>();
    }

    addTrack(track: RailTrack): string {
        const uuid = track.getUUID();
        this.tracks.set(uuid, track);
        return uuid;
    }

    removeTrack(uuid: string): boolean {
        const track = this.tracks.get(uuid);
        if (track) {
            track.destroy();
            this.tracks.delete(uuid);
            this.visibleTracks.delete(uuid);
            return true;
        }
        return false;
    }

    getTrack(uuid: string): RailTrack | undefined {
        return this.tracks.get(uuid);
    }

    getAllTracks(): RailTrack[] {
        return Array.from(this.tracks.values());
    }

    getVisibleTracks(): RailTrack[] {
        return Array.from(this.visibleTracks).map(uuid => this.tracks.get(uuid)).filter(track => track !== undefined) as RailTrack[];
    }

    createStraightTrack(start: Vector2Like, end: Vector2Like): string {
        const startVec = new Vector2(start.x, start.y);
        const endVec = new Vector2(end.x, end.y);
        
        const track = new RailTrack(
            this.scene,
            startVec,
            startVec,
            endVec,
            endVec
        );
        return this.addTrack(track);
    }

    createCurvedTrack(start: Vector2Like, control1: Vector2Like, control2: Vector2Like, end: Vector2Like): string {
        const track = new RailTrack(
            this.scene,
            new Vector2(start.x, start.y),
            new Vector2(control1.x, control1.y),
            new Vector2(control2.x, control2.y),
            new Vector2(end.x, end.y)
        );
        return this.addTrack(track);
    }

    createCircularTrack(center: Vector2Like, radius: number, segments: number = 8): string[] {
        const trackUUIDs: string[] = [];
        const angleStep = (Math.PI * 2) / segments;
        const centerVec = new Vector2(center.x, center.y);

        for (let i = 0; i < segments; i++) {
            const startAngle = i * angleStep;
            const endAngle = (i + 1) * angleStep;

            const start = new Vector2(
                centerVec.x + Math.cos(startAngle) * radius,
                centerVec.y + Math.sin(startAngle) * radius
            );
            const end = new Vector2(
                centerVec.x + Math.cos(endAngle) * radius,
                centerVec.y + Math.sin(endAngle) * radius
            );

            // Calculate control points for smooth curve
            const controlRadius = radius * 0.552284749831; // Magic number for circular approximation
            const control1 = new Vector2(
                start.x - Math.sin(startAngle) * controlRadius,
                start.y + Math.cos(startAngle) * controlRadius
            );
            const control2 = new Vector2(
                end.x - Math.sin(endAngle) * controlRadius,
                end.y + Math.cos(endAngle) * controlRadius
            );

            const uuid = this.createCurvedTrack(start, control1, control2, end);
            trackUUIDs.push(uuid);
        }

        return trackUUIDs;
    }

    updateVisibleTracks(cameraViewBounds: Phaser.Geom.Rectangle) {
        this.visibleTracks.clear();
        
        for (const [uuid, track] of this.tracks) {
            // Get track bounds and check if they intersect with camera view
            const trackBounds = track.getBounds();
            if (Phaser.Geom.Rectangle.Overlaps(cameraViewBounds, trackBounds)) {
                this.visibleTracks.add(uuid);
            }
        }
    }

    getClosestTrack(position: Vector2Like, maxDistance: number = Infinity): RailTrack | undefined {
        let closestTrack: RailTrack | undefined;
        let closestDistance = maxDistance;
        const posVec = new Vector2(position.x, position.y);

        for (const track of this.getVisibleTracks()) {
            const trackMidpoint = track.getCurvePath().getPoint(0.5);
            const distance = posVec.distance(trackMidpoint);

            if (distance < closestDistance) {
                closestDistance = distance;
                closestTrack = track;
            }
        }

        return closestTrack;
    }

    getTracksInRadius(position: Vector2Like, radius: number): RailTrack[] {
        const posVec = new Vector2(position.x, position.y);
        return this.getVisibleTracks().filter(track => {
            const trackMidpoint = track.getCurvePath().getPoint(0.5);
            return posVec.distance(trackMidpoint) <= radius;
        });
    }
}
