import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { PricingService } from '../services/pricingService.js';

const pricingResultSchema = z.object({
  totalBaseCost: z.number(),
  suggestedPrice: z.number(),
  markup: z.number(),
  netProfit: z.number(),
  atSellingPrice: z.object({
    markup: z.number(),
    contributionMargin: z.number(),
    netProfit: z.number(),
  }).optional(),
});

export async function pricingRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);

  /**
   * POST /pricing/calculate
   *
   * Executa o cálculo de precificação usando o PricingService.
   * Os parâmetros globais (hourlyRate, investmentRate) são lidos das
   * GlobalSettings, sem necessidade de o frontend conhecê-los.
   *
   * Todos os campos de taxa são decimais: 0.20 = 20%
   */
  app.post('/calculate', {
    schema: {
      tags: ['Pricing'],
      summary: 'Calcular precificação de um produto',
      description: 'Todos os campos de taxa são decimais: 0.20 = 20%. Os parâmetros globais (hourlyRate, investmentRate) são lidos automaticamente das configurações da loja.',
      security: [{ BearerAuth: [] }],
      body: z.object({
        acquisitionCost: z.number().min(0),
        shippingCost:    z.number().min(0).default(0),
        taxRate:         z.number().min(0).max(1).default(0),
        desiredMargin:   z.number().min(0).max(1).default(0),
        sellingPrice:    z.number().min(0).optional().describe('Preço de venda para calcular margem a esse preço'),
        directCosts:     z.number().min(0).default(0),
        timeSpent:       z.number().min(0).default(0).describe('Horas gastas'),
        lossIndex:       z.number().min(0).max(1).default(0).describe('Índice de perda (decimal: 0.05 = 5%)'),
      }),
      response: {
        200: pricingResultSchema,
      },
    },
  }, async (request) => {
    const body = request.body;

    // Lê as configurações globais (hourlyRate, investmentRate)
    const settings = await prisma.globalSettings.findUnique({
      where: { id: 'default' },
    });

    const hourlyRate    = settings?.hourlyRate    ?? 0;
    const investmentRate = settings?.investmentRate ?? 0;

    const result = PricingService.calculate({
      acquisitionCost: body.acquisitionCost,
      shippingCost:    body.shippingCost,
      taxRate:         body.taxRate,
      desiredMargin:   body.desiredMargin,
      directCosts:     body.directCosts,
      timeSpent:       body.timeSpent,
      lossIndex:       body.lossIndex,
      hourlyRate,
      investmentRate,
    });

    const response = {
      totalBaseCost:  result.totalBaseCost,
      suggestedPrice: result.suggestedPrice,
      markup:         result.markup,
      netProfit:      result.netProfit,
      atSellingPrice: body.sellingPrice !== undefined ? result.marginAtPrice(body.sellingPrice) : undefined,
    };

    return response;
  });
}
