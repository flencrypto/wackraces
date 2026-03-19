import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../config';

export interface TokenPayload {
  sub: string;
  email: string;
  role: string;
}

export function signAccessToken(payload: TokenPayload): string {
  const opts: SignOptions = { expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'] };
  return jwt.sign(payload, config.jwtSecret, opts);
}

export function signRefreshToken(payload: TokenPayload): string {
  const opts: SignOptions = { expiresIn: config.jwtRefreshExpiresIn as SignOptions['expiresIn'] };
  return jwt.sign(payload, config.jwtRefreshSecret, opts);
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, config.jwtSecret) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, config.jwtRefreshSecret) as TokenPayload;
}
