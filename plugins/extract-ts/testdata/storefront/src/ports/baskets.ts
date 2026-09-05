export interface Baskets {
  addItem(basketId: string, sku: string): Promise<{ id: string }>;
}
