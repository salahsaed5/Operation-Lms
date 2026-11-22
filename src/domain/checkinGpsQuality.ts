export type GpsVerificationStatus = 'missing' | 'good' | 'poor' | 'outside' | 'uncertain';
export interface GpsVerificationSnapshot {
  accuracy: number;
  distance: number;
}
export function requiredGpsAccuracyMeters(geofenceRadius: number): number {
  return Math.min(50, geofenceRadius / 2);
}
/** Check whether entire uncertainty circle is inside the venue radius. */
export function classifyGpsVerification(
  snapshot: GpsVerificationSnapshot | null,
  geofenceRadius: number
): GpsVerificationStatus {
  if (!snapshot) return 'missing';
  if (!Number.isFinite(snapshot.accuracy) || snapshot.accuracy < 1 ||
      !Number.isFinite(snapshot.distance) || snapshot.distance < 0 ||
      !Number.isFinite(geofenceRadius) || geofenceRadius <= 0) return 'poor';
  if (snapshot.accuracy > requiredGpsAccuracyMeters(geofenceRadius)) return 'poor';
  if (snapshot.distance > geofenceRadius) return 'outside';
  if (snapshot.distance + snapshot.accuracy > geofenceRadius) return 'uncertain';
  return 'good';
}
