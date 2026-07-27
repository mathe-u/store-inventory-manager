import { type FastifyRequest, type FastifyReply } from 'fastify';
import { hasPermission, type PermissionKey } from './permissions.js';

/**
 * Middleware factory: retorna um preHandler que verifica se o
 * usuário autenticado tem a permissão informada.
 *
 * Uso nas rotas:
 *   { preHandler: [app.authenticate, authorize('category:create')] }
 */
export function authorize(permission: PermissionKey) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        const user = request.user as { sub: string; name: string; role: string };

        if (!user?.role) {
            return reply.status(403).send({ message: 'Forbidden: no role assigned' });
        }

        if (!hasPermission(user.role, permission)) {
            return reply.status(403).send({ message: 'Forbidden: insufficient permissions' });
        }
    };
}
