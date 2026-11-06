export interface PayloadFindResponse<T> {
  docs: T[];
  totalDocs: number;
  limit: number;
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

type BaseDoc = Record<string, any>;

export type PayloadMediaDoc = BaseDoc;
export type PayloadCategoryDoc = BaseDoc;
export type PayloadStockStatus = "in_stock" | "out_of_stock" | "on_backorder" | string;
export type PayloadProductDoc = BaseDoc;
export type PayloadStoreDoc = BaseDoc;
export type PayloadUserDoc = BaseDoc;
export type PayloadReviewDoc = BaseDoc;
export type PayloadCustomerDoc = BaseDoc;
export type PayloadReturnDoc = BaseDoc;
export type PayloadReferralDoc = BaseDoc;
export type PayloadStoreArticleDoc = BaseDoc;
export type PayloadBroadcastLogDoc = BaseDoc;

export type PayloadStockHistoryEntry = BaseDoc;
export type PayloadOrderItemDoc = BaseDoc;
export type PayloadOrderDoc = BaseDoc;

export interface CreateOrderSuccessResponse {
  success: true;
  orderId: string;
  order: PayloadOrderDoc;
}

export interface CreateOrderErrorResponse {
  success: false;
  error: string;
  code?: string;
  unavailableItems?: { productId: string; title: string; reason: string }[];
}

export type CreateOrderResponse = CreateOrderSuccessResponse | CreateOrderErrorResponse;
