export interface Money {
  amount: number;
  currency: "PKR";
  formatted: string;
}

const pkrFormatter = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});

export function toMoney(amount: number): Money {
  return { amount, currency: "PKR", formatted: pkrFormatter.format(amount) };
}
