/**
 * Static mock data backing the variance charts and markup comparison table.
 * Replace with live data when /api/pricing endpoints are available.
 */

export interface CountryVariance {
  country: string;
  actual: number;
  simulation: number;
}

export interface ProductVariance {
  product: string;
  actual: number;
  simulation: number;
}

export interface CountryProducts {
  country: string;
  products: { name: string; current: number; proposed: number }[];
}

export const countryVariance: CountryVariance[] = [
  { country: 'El Salvador', actual: 1.26, simulation: 1.33 },
  { country: 'Honduras', actual: 1.35, simulation: 1.36 },
  { country: 'Panama', actual: 1.28, simulation: 1.26 },
  { country: 'Puerto Rico', actual: 1.17, simulation: 1.17 },
  { country: 'Guatemala', actual: 1.28, simulation: 1.28 },
  { country: 'Ecuador', actual: 1.08, simulation: 1.08 },
];

export const productVariance: ProductVariance[] = [
  { product: 'Product 1', actual: 1.26, simulation: 1.36 },
  { product: 'Product 2', actual: 1.24, simulation: 1.31 },
  { product: 'Product 3', actual: 1.05, simulation: 1.09 },
  { product: 'Product 4', actual: 1.30, simulation: 1.36 },
  { product: 'Product 5', actual: 1.18, simulation: 1.23 },
];

export const markupData: CountryProducts[] = [
  {
    country: 'El Salvador',
    products: [
      { name: 'Product 1', current: 51.0, proposed: 55.5 },
      { name: 'Product 2', current: 33.0, proposed: 31.1 },
      { name: 'Product 3', current: 2.0, proposed: -9.2 },
      { name: 'Product 4', current: 57.0, proposed: 57.4 },
      { name: 'Product 5', current: 17.0, proposed: 27.3 },
    ],
  },
  {
    country: 'Honduras',
    products: [
      { name: 'Product 1', current: 25.0, proposed: 31.5 },
      { name: 'Product 2', current: 19.0, proposed: 29.4 },
      { name: 'Product 3', current: 9.0, proposed: 5.2 },
      { name: 'Product 4', current: 18.0, proposed: 60.4 },
      { name: 'Product 5', current: 24.0, proposed: 33.0 },
    ],
  },
  {
    country: 'Panama',
    products: [
      { name: 'Product 1', current: 27.0, proposed: 41.1 },
      { name: 'Product 2', current: 20.0, proposed: 36.2 },
      { name: 'Product 3', current: 26.0, proposed: 1.2 },
      { name: 'Product 4', current: 99.0, proposed: 83.3 },
      { name: 'Product 5', current: 2.0, proposed: 31.4 },
    ],
  },
  {
    country: 'Puerto Rico',
    products: [
      { name: 'Product 1', current: 46.0, proposed: 56.6 },
      { name: 'Product 2', current: 30.0, proposed: 25.3 },
      { name: 'Product 3', current: 13.0, proposed: 8.3 },
      { name: 'Product 4', current: 19.0, proposed: 37.6 },
      { name: 'Product 5', current: 22.0, proposed: 26.5 },
    ],
  },
  {
    country: 'Guatemala',
    products: [
      { name: 'Product 1', current: 22.0, proposed: 29.7 },
      { name: 'Product 2', current: 12.0, proposed: 17.6 },
      { name: 'Product 3', current: 15.0, proposed: 6.1 },
      { name: 'Product 4', current: 45.0, proposed: 50.9 },
      { name: 'Product 5', current: 20.0, proposed: 24.5 },
    ],
  },
];
