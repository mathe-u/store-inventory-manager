import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
// import type { Category } from '../generated/prisma/index.js';

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

    let dateFilter = {}
    let previousDateFilter = {}

    if (days) {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      dateFilter = { createdAt: { gte: startDate } };

      const previousStartDate = new Date(startDate);
      previousStartDate.setDate(previousStartDate.getDate() - days);

      previousDateFilter = {
        createdAt: {
          gte: previousStartDate,
          lt: startDate
        }
      }
    }

    const sales = await prisma.sale.findMany({
      where: dateFilter,
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    });

    const settings = await prisma.globalSettings.findUnique({ where: { id: 'default' } });
    const hourlyRate = settings?.hourlyRate ?? 0;
    const investmentRate = settings?.investmentRate ?? 0;
    
    let totalAcquisitionAndDirectCosts = 0;
    let totalLaborAndProvisions = 0;
    let totalShippingAndTaxes = 0;
    let totalNetProfitCompleted = 0;
    let totalRevenueCompleted = 0;

    const completedSales = sales.filter(sale => sale.status === 'COMPLETED');

    completedSales.forEach((sale) => {
      const product = sale.product;
      const quatity = sale.quantity;

      const discountValue = 0;
      const customsValue = product.acquisitionCost - discountValue + product.shippingCost;
      const baseICMS = product.taxRate < 1 ? customsValue / (1 - product.taxRate) : customsValue;
      const icmsTax = product.taxRate < 1 ? baseICMS * product.taxRate : 0;
      const sellerWage = product.timeSpent * hourlyRate;
      
      totalAcquisitionAndDirectCosts += (product.acquisitionCost + product.directCosts) * quatity;
      totalLaborAndProvisions += (sellerWage + (sale.finalPrice * investmentRate) + (sale.finalPrice * product.lossIndex)) * quatity;
      totalShippingAndTaxes += (product.shippingCost + icmsTax) * quatity;
      totalNetProfitCompleted += sale.calculatedProfit;
      totalRevenueCompleted += sale.finalPrice * quatity;
    });

    const hasRevenue = totalRevenueCompleted > 0;
    const netProfitPercent = hasRevenue ? (totalNetProfitCompleted / totalRevenueCompleted) : 0;
    const costsPercent = hasRevenue ? ((totalAcquisitionAndDirectCosts + totalLaborAndProvisions) / totalRevenueCompleted) : 0;
    const deliveryTaxPercent = hasRevenue ? (totalShippingAndTaxes / totalRevenueCompleted) : 0;

    const previousSales = days ? await prisma.sale.findMany(
      {
        where: previousDateFilter
      }
    ) : [];

    const grossRevenue = sales.reduce((acc, sale) => acc + (sale.finalPrice * sale.quantity), 0 as number);
    const netRevenue = sales.filter(sale => sale.status === 'COMPLETED').reduce((acc, sale) => acc + (sale.finalPrice * sale.quantity), 0);

    const grossProfit = 0;

    const netProfit = sales.reduce((acc, sale) => acc + sale.calculatedProfit, 0 as number);
    const totalOrders = sales.length;

    const previousGrossRevenue = previousSales.reduce((acc, sale) => acc + (sale.finalPrice * sale.quantity), 0);
    const previousNetProfit = previousSales.reduce((acc, sale) => acc + sale.calculatedProfit, 0);
    const previousTotalOrders = previousSales.length;

    const calculateDelta = (current: number, previous: number) => {
      if (!days ) return 0;
      if (previous > 0) return (current - previous) / previous;
      if (current > 0) return 1;
      return 0;
    }

    const grossRevenueDelta = calculateDelta(grossRevenue, previousGrossRevenue);
    const netProfitDelta = calculateDelta(netProfit, previousNetProfit);
    const totalOrdersDelta = calculateDelta(totalOrders, previousTotalOrders);

    // Group by month
    // grafico de barras duplas (faturamento bruto, custos) ao longo do tempo (mes)
    const monthlyStats: Record<string, { grossRevenue: number; costs: number }> = {};

    sales.forEach((sale) => {
      const date = sale.createdAt.toISOString().slice(0, 7); // YYYY-MM
      if (!monthlyStats[date]) {
        monthlyStats[date] = { grossRevenue: 0, costs: 0 };
      }

      monthlyStats[date].grossRevenue += sale.finalPrice * sale.quantity;
      monthlyStats[date].costs += 2 * sale.quantity;
    });

    // Top selling products
    const productSales: Record<string, { productId: string; name: string; category: string | null; quantity: number }> = {};
    const salesWithProduct = await prisma.sale.findMany({
      where: { status: 'COMPLETED'
        ,
        ...dateFilter,
        },
      include: { product: { include: { category: true } } }
    });

    for (const sale of salesWithProduct) {
      const id = sale.productId;
      const category = sale.product.category;

      if (!productSales[id]) {
        productSales[id] = { productId: sale.productId, name: sale.product.name, category: category?.name ?? null, quantity: 0 };
      }
      productSales[id].quantity += sale.quantity;
    }

    const topSelling = Object.values(productSales)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    return {
      grossRevenue,
      grossRevenueDelta,
      netRevenue,
      grossProfit,
      netProfit,
      netProfitDelta,
      totalOrders,
      totalOrdersDelta,
      monthlyStats: Object.entries(monthlyStats).map(([date, data]) => ({ date, ...data })),
      marginBreakdown: {
        netProfit: Number(netProfitPercent.toFixed(1)),
        costs: Number(costsPercent.toFixed(1)),
        deliveryTax: Number(deliveryTaxPercent.toFixed(1)),
      },
      topSelling,
    };
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
    // TODO: tratar dias que nao houver nunhuma venda
    const { productId } = request.params;
    const { days } = request.query;

    let dateFilter = {};
  if (days) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    dateFilter = { createdAt: { gte: startDate } };
  }

    const sales = await prisma.sale.findMany({
      where: { productId, status: 'COMPLETED', ...dateFilter },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, finalPrice: true },
    });

    const dailyPriceMap: Record<string, {date: string; sumPrice: number; count: number }> = {};

    sales.forEach((sale) => {
      const dateStr = sale.createdAt.toISOString().slice(0, 10);

      if (!dailyPriceMap[dateStr]) {
        dailyPriceMap[dateStr] = { date: dateStr, sumPrice: 0, count: 0 };
      }

      dailyPriceMap[dateStr].sumPrice += sale.finalPrice;
      dailyPriceMap[dateStr].count += 1;
    });

    const timeSeries = Object.values(dailyPriceMap).map((day) => ({
      date: day.date,
      price: Number((day.sumPrice / day.count).toFixed(2)),
    }));

    return timeSeries;
  });
}
