import { SignJWT } from 'jose';
import { config } from '../config';
import { getPrivateKey } from '../keys';

function base(role: string) {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'RS256', kid: config.jwtKid })
    .setIssuer(config.jwtIssuer)
    .setAudience(config.jwtAudience)
    .setIssuedAt();
}

// Token du khach: jti = access_sessions.id, het han theo validity_hours cua ve
export function signTouristToken(p: { sessionId: string; lang?: string; expiresAt: Date }) {
  return base('TOURIST')
    .setSubject(p.sessionId)
    .setJti(p.sessionId)
    .setExpirationTime(Math.floor(p.expiresAt.getTime() / 1000))
    .sign(getPrivateKey());
}

export function signStaffToken(p: { staffId: string; role: string; username: string }) {
  return new SignJWT({ role: p.role, username: p.username })
    .setProtectedHeader({ alg: 'RS256', kid: config.jwtKid })
    .setIssuer(config.jwtIssuer)
    .setAudience(config.jwtAudience)
    .setIssuedAt()
    .setSubject(p.staffId)
    .setExpirationTime(`${config.staffTokenTtlSec}s`)
    .sign(getPrivateKey());
}
