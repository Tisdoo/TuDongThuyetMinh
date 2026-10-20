// Kiểu dữ liệu theo hợp đồng API (mục 6 kế hoạch) và dataset.json do poi-service build.

export interface ApiError { error: { code: string; message: string } }

export interface Product { code: string; name: string; price: number; currency: string; validity_hours: number }

export interface OnlineOrder { orderCode: string; amount: number; currency: string; paymentUrl: string; authCode: string; expiresAt: string }
export interface CashOrder { orderCode: string; orderId: string; amount: number; currency: string; expiresAt: string }
export interface MomoOrder {
  orderCode: string; amount: number; currency: string; expiresAt: string; authCode: string;
  qr: { imageUrl: string; accountName: string; transferNote: string };
}
export type OrderStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'CANCELLED' | string;
export interface OrderStatusRes { orderCode: string; method: string; status: OrderStatus; expiresAt: string }

export interface TokenRes { accessToken: string; expiresAt: string }

export interface PoiTranslation {
  name: string; shortDescription: string | null; description: string | null;
  audioUrl: string | null; audioDurationSec: number | null;
}
export interface Poi {
  id: string; code: string; categoryId: number | null;
  lat: number; lng: number; triggerRadiusM: number; priority: number;
  thumbnailUrl: string | null;
  media: Array<{ url: string; caption: string | null }>;
  translations: Record<string, PoiTranslation>;
}
export interface Language { code: string; name: string; nativeName: string | null }
export interface Dataset {
  version: number; generatedAt?: string;
  languages: Language[];
  categories: Array<{ id: number; code: string; iconUrl: string | null; color: string | null }>;
  pois: Poi[];
  tours: unknown[];
}

export interface ChatReply { answer: string }
