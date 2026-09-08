import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DashboardService } from '../services/DashboardService.js';

const monthlyStatSchema = z.object({
  date: z.string(),
  grossRevenue: z.number(),
  costs: z.number(),
});

const marginBreakdownSchema = z.object({
  netProfit: z.number(),
  costs: z.number(),
  deliveryTax: z.number(),
});

const topSellingItemSchema = z.object({
  productId: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  quantity: z.number(),
});

const dashboardStatsSchema = z.object({
  grossRevenue: z.number(),
  grossRevenueDelta: z.number(),
  netRevenue: z.number(),
  grossProfit: z.number(),
  netProfit: z.number(),
  netProfitDelta: z.number(),
  totalOrders: z.number(),
  totalOrdersDelta: z.number(),
  monthlyStats: z.array(monthlyStatSchema),
  marginBreakdown: marginBreakdownSchema,
  topSelling: z.array(topSellingItemSchema),
});

const priceEvolutionItemSchema = z.object({
  date: z.string(),
  price: z.number(),
});

export async function dashboardRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);

  app.get('/stats', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Obter estatísticas gerais do dashboard',
      security: [{ BearerAuth: [] }],
      querystring: z.object({
        days: z.coerce.number().positive().optional().describe('Filtrar por últimos N dias'),
      }),
      response: {
        200: dashboardStatsSchema,
      },
    },
  }, async (request) => {
    const { days } = request.query;
    return await DashboardService.getDashboardStats(days);
  });

  app.get('/price-evolution/:productId', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Evolução de preço de venda de um produto ao longo do tempo',
      security: [{ BearerAuth: [] }],
      params: z.object({ productId: z.uuid() }),
      querystring: z.object({ days: z.coerce.number().positive().optional() }),
      response: {
        200: z.array(priceEvolutionItemSchema),
      },
    },
  }, async (request) => {
    const { productId } = request.params;
    const { days } = request.query;

    return await DashboardService.getPriceEvolution(productId, days);
  });
}
