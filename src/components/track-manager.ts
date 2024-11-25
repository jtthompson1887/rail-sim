import RailTrack from "./track";
import Vector2 = Phaser.Math.Vector2;
import Vector2Like = Phaser.Types.Math.Vector2Like;
import Sprite = Phaser.GameObjects.Sprite;
import Junction from "./junction"; // Assuming Junction class is in junction.ts file

export default class TrackManager {
    private tracks: Map<string, RailTrack>;
    private junctions: Map<string, Junction>;
    private scene: Phaser.Scene;
    private visibleTracks: Set<string>;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.tracks = new Map<string, RailTrack>();
        this.junctions = new Map<string, Junction>();
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

    createJunction(trackUUID: string, position: number): Junction | null {
        const track = this.tracks.get(trackUUID);
        if (!track) return null;

        // Get the junction point position
        const mainPath = track.getCurvePath();
        const junctionPoint = mainPath.getPoint(position);
        const mainTangent = mainPath.getTangent(position);
        const mainAngle = Math.atan2(mainTangent.y, mainTangent.x);

        // Create left and right branch tracks
        const length = 400;
        const leftAngle = -Math.PI / 12; // -15 degrees
        const rightAngle = Math.PI / 12;  // 15 degrees

        // Create left branch
        const leftEnd = new Vector2(
            junctionPoint.x + Math.cos(mainAngle + leftAngle) * length,
            junctionPoint.y + Math.sin(mainAngle + leftAngle) * length
        );
        const leftControl1 = new Vector2(
            junctionPoint.x + Math.cos(mainAngle + leftAngle * 0.5) * length * 0.3,
            junctionPoint.y + Math.sin(mainAngle + leftAngle * 0.5) * length * 0.3
        );
        const leftControl2 = new Vector2(
            leftEnd.x - Math.cos(mainAngle + leftAngle) * length * 0.3,
            leftEnd.y - Math.sin(mainAngle + leftAngle) * length * 0.3
        );
        const leftTrack = new RailTrack(
            this.scene,
            junctionPoint,
            leftControl1,
            leftControl2,
            leftEnd
        );

        // Create right branch
        const rightEnd = new Vector2(
            junctionPoint.x + Math.cos(mainAngle + rightAngle) * length,
            junctionPoint.y + Math.sin(mainAngle + rightAngle) * length
        );
        const rightControl1 = new Vector2(
            junctionPoint.x + Math.cos(mainAngle + rightAngle * 0.5) * length * 0.3,
            junctionPoint.y + Math.sin(mainAngle + rightAngle * 0.5) * length * 0.3
        );
        const rightControl2 = new Vector2(
            rightEnd.x - Math.cos(mainAngle + rightAngle) * length * 0.3,
            rightEnd.y - Math.sin(mainAngle + rightAngle) * length * 0.3
        );
        const rightTrack = new RailTrack(
            this.scene,
            junctionPoint,
            rightControl1,
            rightControl2,
            rightEnd
        );

        // Add tracks to manager
        this.addTrack(leftTrack);
        this.addTrack(rightTrack);

        // Create junction with all three tracks
        const junction = new Junction(this.scene, track, leftTrack, rightTrack, position);
        this.junctions.set(junction.getUUID(), junction);

        // Set initial visibility
        leftTrack.setAlpha(0.5);
        rightTrack.setAlpha(1); // Right is default active branch

        return junction;
    }

    getJunctionsForTrack(track: RailTrack): Junction[] {
        return Array.from(this.junctions.values())
            .filter(j => {
                const tracks = j.getAllTracks();
                return tracks.indexOf(track) !== -1;
            });
    }

    getClosestTrack(point: Vector2Like, limit: number = 0, currentTrack?: RailTrack): RailTrack | null {
        let closestTrack: RailTrack | null = null;
        let closestDistance = Infinity;

        // Create a temporary trackable object
        const tempTrackable = new Phaser.GameObjects.Sprite(this.scene, point.x, point.y, '');

        for (const track of this.tracks.values()) {
            // Skip inactive branch tracks
            const junctions = this.getJunctionsForTrack(track);
            const isBranchTrack = junctions.some(j => {
                const activeBranch = j.getActiveBranchTrack();
                const inactiveBranch = j.getInactiveBranchTrack();
                return track === activeBranch || track === inactiveBranch;
            });
            
            if (isBranchTrack) {
                const isActive = junctions.some(j => track === j.getActiveBranchTrack());
                if (!isActive && track !== currentTrack) {
                    continue;
                }
            }

            const trackPoint = track.getTrackPoint(tempTrackable);
            const distance = new Vector2(trackPoint.x - point.x, trackPoint.y - point.y).length();

            if (distance < closestDistance && (!limit || distance < limit)) {
                closestDistance = distance;
                closestTrack = track;
            }
        }

        // Clean up temporary object
        tempTrackable.destroy();

        return closestTrack;
    }

    getTracksInRadius(position: Vector2Like, radius: number): RailTrack[] {
        const posVec = new Vector2(position.x, position.y);
        return this.getVisibleTracks().filter(track => {
            const trackMidpoint = track.getCurvePath().getPoint(0.5);
            return posVec.distance(trackMidpoint) <= radius;
        });
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
}
