export interface PricingInput {
  acquisitionCost: number;
  shippingCost: number;
  taxRate: number; // percentage
  directCosts: number;
  timeSpent: number; // hours
  lossIndex: number; // percentage
  desiredMargin: number; // percentage
  hourlyRate: number;
}

export interface PricingOutput {
  totalBaseCost: number;
  costWithLoss: number;
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
      timeSpent,
      lossIndex,
      desiredMargin,
      hourlyRate,
    } = input;

    // 1. Calculate Tax Amount (usually on acquisition cost or total base)
    // For simplicity, let's assume tax is percentage over acquisition cost
    const taxAmount = acquisitionCost * (taxRate / 100);

    // 2. Base Cost
    const totalBaseCost = acquisitionCost + shippingCost + taxAmount + directCosts + (timeSpent * hourlyRate);

    // 3. Adjusted for Loss
    const costWithLoss = lossIndex > 0 ? totalBaseCost / (1 - lossIndex / 100) : totalBaseCost;

    // 4. Suggested Price based on Desired Margin
    // Markup strategy: Price = Cost / (1 - margin)
    const suggestedPrice = desiredMargin < 100 ? costWithLoss / (1 - desiredMargin / 100) : costWithLoss;

    const markup = suggestedPrice / totalBaseCost;

    return {
      totalBaseCost,
      costWithLoss,
      suggestedPrice,
      markup,
      netProfit: suggestedPrice - totalBaseCost,
      marginAtPrice: (price: number) => {
        const netProfit = price - totalBaseCost;
        const contributionMargin = price > 0 ? (netProfit / price) * 100 : 0;
        const markupAtPrice = totalBaseCost > 0 ? price / totalBaseCost : 0;
        
        return {
          markup: markupAtPrice,
          contributionMargin,
          netProfit,
        };
      },
    };
  }
}
