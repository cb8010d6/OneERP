import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import type {
  JwtTokenPayload,
  JwtUserPayload,
} from '../../core/http/request.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  validate(payload: JwtTokenPayload): JwtUserPayload {
    // payload.sub is the user UUID
    return { id: payload.sub, email: payload.email };
  }
}
