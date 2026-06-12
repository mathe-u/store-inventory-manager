import 'fastify';
import { type FastifyRequest, type FastifyReply } from 'fastify';

declare module 'fastify' {
    export interface FastifyInstance {
        authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    }
}