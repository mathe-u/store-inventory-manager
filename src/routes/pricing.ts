import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { PricingService } from '../services/pricingService.js';

export async function pricingRoutes(app: FastifyInstance) {
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
  app.post('/calculate', async (request) => {
    const bodySchema = z.object({
      acquisitionCost: z.number().min(0),
      shippingCost:    z.number().min(0).default(0),
      taxRate:         z.number().min(0).max(1).default(0),   // decimal: 0.20 = 20%
      desiredMargin:   z.number().min(0).max(1).default(0),   // decimal: 0.30 = 30%
      sellingPrice:    z.number().min(0).optional(),           // para calcular marginAtPrice
      directCosts:     z.number().min(0).default(0),
      timeSpent:       z.number().min(0).default(0),           // horas
      lossIndex:       z.number().min(0).max(1).default(0),   // decimal: 0.05 = 5%
    });

    const body = bodySchema.parse(request.body);

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

    const response: Record<string, unknown> = {
      totalBaseCost:  result.totalBaseCost,
      suggestedPrice: result.suggestedPrice,
      markup:         result.markup,
      netProfit:      result.netProfit,
    };

    // Se o frontend informou um preço de venda, retorna os indicadores para ele
    if (body.sellingPrice !== undefined) {
      response.atSellingPrice = result.marginAtPrice(body.sellingPrice);
    }

    return response;
  });
}
