import 'fastify';
import { type FastifyRequest, type FastifyReply } from 'fastify';

declare module 'fastify' {
    export interface FastifyInstance {
        authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    }
}

declare module '@fastify/jwt' {
    interface FastifyJWT {
        payload: {
            sub: string;
            name: string;
            role: string;
        };
        user: {
            sub: string;
            name: string;
            role: string;
        };
    }
}