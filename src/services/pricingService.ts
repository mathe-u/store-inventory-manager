export interface PricingInput {
  acquisitionCost: number;
  shippingCost: number;
  taxRate: number; // percentage (ex: 0,20 => 20%)
  directCosts: number;
  investmentRate: number; // percentage (ex: 0,20 => 20%)
  timeSpent: number; // hours
  lossIndex: number; // percentage (ex: 0,20 => 20%)
  desiredMargin: number; // percentage (ex: 0,20 => 20%)
  hourlyRate: number;
}

export interface PricingOutput {
  totalBaseCost: number;
  // costWithLoss: number;
  suggestedPrice: number;
  markup: number;
  netProfit: number;
  marginAtPrice: (price: number) => {
    markup: number;
    contributionMargin: number;
    netProfit: number;
  };
}

export class PricingService {
  static calculate(input: PricingInput): PricingOutput {
    const {
      acquisitionCost,
      shippingCost,
      taxRate,
      directCosts,
      investmentRate,
      timeSpent,
      lossIndex,
      desiredMargin,
      hourlyRate,
    } = input;

    // 1. Calculate Tax Amount
    // o calculo do imposto (ICMS) é feito com base no valor final do pedido (preco do item + frete + beneficios/descontos).
    // Outros benefícios/descontos incluem cupons, créditos, moedas etc, do AliExpress.
    // 2026 imposto de importacao nao eh mais cobrado para compras abaixo de $50, so icms
    // acquisitionCost = preco do item
    const discountValue = 0;
    const customsValue = acquisitionCost - discountValue + shippingCost;

    const baseICMS = taxRate < 1 ? customsValue / (1 - taxRate) : customsValue;
    const icmsTax = taxRate < 1 ? baseICMS * taxRate : 0;

    const sellerWage = timeSpent * hourlyRate;

    // 2. Base Cost + sellerWage
    const totalBaseCost = acquisitionCost + shippingCost + icmsTax + directCosts + sellerWage;

    // 3. Divisor do Markup (Taxas que incidem sobre o PREÇO FINAL de venda)
    // Inclui a margem de lucro, marketing, perdas e impostos de nota fiscal de venda
    const totalDeductionsRate = desiredMargin + investmentRate + lossIndex;

    const divisor = totalDeductionsRate < 1 ? (1 - totalDeductionsRate) : 0.01;

    // 4. Markup e Preço Sugerido
    const markup = 1 / divisor;
    const suggestedPrice = totalBaseCost * markup;

    // const investmentValue = suggestedPrice * investmentRate;
    // const lossValue = suggestedPrice * lossIndex;

    const netProfit = suggestedPrice - totalBaseCost - (suggestedPrice * investmentRate) - (suggestedPrice * lossIndex);

    return {
      totalBaseCost,
      // costWithLoss,
      suggestedPrice,
      markup,
      netProfit,
      marginAtPrice: (price: number) => {
        const currentNetProfit = price - totalBaseCost - (price * investmentRate) - (price * lossIndex);
        const contributionMargin = price > 0 ? (currentNetProfit / price) * 100 : 0;
        const markupAtPrice = totalBaseCost > 0 ? price / totalBaseCost : 0;

        return {
          markup: markupAtPrice,
          contributionMargin,
          netProfit: currentNetProfit,
        };
      },
    };
  }
}
