# WareTrack 3D — Trung tâm điều hành kho vận 3D (demo ERP)

Bản dựng lại web app trong video tham chiếu (`docs/ref/reference_video.mp4`):
- bản đồ thành phố 3D isometric với 5 kho;
- xe tải, xe nâng, pallet chuyển động theo thời gian thực;
- giao diện điều hành kính mờ: KPI, panel chi tiết, theo dõi đơn hàng, Fleet.

Toàn bộ dữ liệu là dữ liệu giả lập.

## Chạy

```bash
npm install
npm run dev
```

Mở http://localhost:5173. Bản build production: `npm run build`, rồi `npm run preview`.

Link sâu (mở thẳng một kho / một đối tượng):
`/?site=WH-04&select=truck:TRK-2205&tab=trucks` · `/?site=ALL` (tổng quan mạng lưới) · `/?select=forklift:FL-01`

## Thao tác

- Kéo chuột trái để di chuyển bản đồ, chuột phải để xoay, cuộn để zoom. Có thêm các nút + − ⟲ ⟳ ⌂.
- Rê chuột vào xe, pallet, dock, trạm sạc hoặc tòa nhà sẽ hiện nhãn. Click để mở panel chi tiết; Esc hoặc ✕ để đóng.
- Chọn kho ở thanh trên cùng: `›` sang kho kế tiếp, `⌄` mở danh sách (gồm "Network overview").
- Tìm kiếm: nhấn `/` rồi gõ (ví dụ "helmet", "TRK-2205", "FL-12").
- Panel xe: nút ⌖ đưa camera tới đối tượng, nút ↗ cho camera bám theo xe.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `src/data/mockData.js` | Dữ liệu ERP giả lập: kho, mã hàng (SKU), hãng vận tải, xe tải, xe nâng, pallet (LPN), dock, trạm sạc, đơn vận chuyển, thông báo |
| `src/data/db.js`, `selectors.js`, `format.js` | Lớp truy cập dữ liệu, số liệu dẫn xuất (KPI, tiến độ, hàng đợi) và định dạng hiển thị |
| `src/data/layout.js` | Bố cục không gian: vị trí dock, bãi, tuyến đường, góc camera từng kho |
| `src/state/store.js` | Trạng thái giao diện và event bus |
| `src/state/simulation.js` | Mô phỏng vận hành: xe vào cổng, lùi vào dock, bốc/dỡ hàng, xe nâng, sạc pin, đồng hồ |
| `src/three/` | Scene, camera, tương tác, thế giới 3D, các mô hình (`models/`) |
| `src/ui/` | Toàn bộ giao diện overlay |
| `docs/SPEC.md` | Đặc tả và hợp đồng API giữa các module |
| `dev/*.html` | Trang thử riêng từng phần, ví dụ http://localhost:5173/dev/buildings.html |

## Nối với ERP thật

UI và 3D chỉ đọc dữ liệu qua `db.js` và `selectors.js`. Muốn nối ERP/WMS thật thì làm 3 bước:

1. Thay `mockData.js` bằng dữ liệu tải từ API, giữ nguyên tên trường.
2. Đưa vị trí xe thật (GPS/RTLS) vào `position` / `heading`, hoặc để `simulation.js` nội suy giữa các mốc.
3. Mỗi khi dữ liệu thay đổi, gọi `bus.emit('data:update')` để giao diện cập nhật.
