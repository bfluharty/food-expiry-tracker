export interface FoodItem {
  pk: 'ITEM';
  sk: string;
  name: string;
  category: string;
  expirationDate: string;
  quantity: number;
  updatedAt: string;
}

export interface UploadError {
  line: number;
  message: string;
}
