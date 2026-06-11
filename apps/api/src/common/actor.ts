/**
 * Istek sahibi (actor) baglami: JWT claim'lerinden turetilir, para/yonetim
 * servislerine gecirilir. Ortak kavram oldugu icin common/'da (yaprak modullere
 * bagimlilik olusturmamak icin — bkz. DECISIONS "Inceleme bulgulari").
 */
export interface ActorContext {
  userId: string;
  tenantId: string;
}
