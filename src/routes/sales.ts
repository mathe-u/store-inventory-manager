import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SalesService } from '../services/SalesService.js';

const saleStatusEnum = z.enum(['COMPLETED', 'LOSS', 'RETURNED', 'PENDING']);

const saleSchema = z.object({
  id: z.string(),
  productId: z.string(),
  quantity: z.number(),
  finalPrice: z.number(),
  calculatedProfit: z.number(),
  status: saleStatusEnum,
  customerName: z.string().nullable(),
  paymentMethodId: z.string(),
  createdAt: z.date(),
});

const errorSchema = z.object({ message: z.string() });
const idParamSchema = z.object({ id: z.uuid() });

const createSaleBodySchema = z.object({
  productId: z.uuid(),
  quantity: z.number().int().min(1),
  finalPrice: z.number(),
  status: saleStatusEnum.default('PENDING'),
  customerName: z.string().optional().nullable(),
  paymentMethodId: z.string().default('cash'),
});

const saleQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  productName: z.string().optional(),
  status: saleStatusEnum.optional(),
});

const paginatedSalesSchema = z.object({
  sales: z.array(z.any()),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

export async function saleRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);

  app.post('/', {
    schema: {
      tags: ['Sales'],
      summary: 'Registrar nova venda',
      security: [{ BearerAuth: [] }],
      body: createSaleBodySchema,
      response: {
        200: z.object({
          sale: saleSchema,
          stockRemaining: z.number(),
        }),
        400: errorSchema,
        404: errorSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const result = await SalesService.createSale(request.body);
      return result;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Product not found') {
          return reply.status(404).send({ message: error.message });
        }
        if (error.message === 'Insufficient stock') {
          return reply.status(400).send({ message: error.message });
        }
      }
      throw error;
    }
  });

  app.get('/', {
    schema: {
      tags: ['Sales'],
      summary: 'Listar vendas',
      security: [{ BearerAuth: [] }],
      querystring: saleQuerySchema,
      response: {
        200: paginatedSalesSchema,
      },
    },
  }, async (request) => {
    return await SalesService.listSales(request.query);
  });

  app.put('/:id', {
    schema: {
      tags: ['Sales'],
      summary: 'Atualizar venda',
      security: [{ BearerAuth: [] }],
      params: idParamSchema,
      body: z.object({
        quantity: z.number().int().min(1).optional(),
        finalPrice: z.number().optional(),
        status: saleStatusEnum.optional(),
        customerName: z.string().optional().nullable(),
        paymentMethodId: z.string().optional(),
      }),
      response: {
        200: z.object({
          sale: saleSchema,
          stockRemaining: z.number(),
        }),
        400: errorSchema,
        404: errorSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    try {
      const result = await SalesService.updateSale(id, request.body);
      return result;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Sale not found') {
          return reply.status(404).send({ message: error.message });
        }
        if (error.message === 'Product not found') {
          return reply.status(404).send({ message: error.message });
        }
        if (error.message === 'Insufficient stock') {
          return reply.status(400).send({ message: error.message });
        }
      }
      throw error;
    }
  });

  app.delete('/:id', {
    schema: {
      tags: ['Sales'],
      summary: 'Remover venda (restaura estoque se COMPLETED/LOSS)',
      security: [{ BearerAuth: [] }],
      params: idParamSchema,
      response: {
        204: z.null(),
        404: errorSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    try {
      await SalesService.deleteSale(id);
      return reply.status(204).send(null);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Sale not found') {
          return reply.status(404).send({ message: error.message });
        }
      }
      throw error;
    }
  });
}
