/**
 * Barrel cho ba hợp đồng schema đóng băng ở `contracts/`. Chỉ re-export — không định nghĩa gì mới
 * ở đây. Xem doc-comment đầu mỗi file (`tagNamespace.ts`, `componentModel.ts`, `hmiScreen.ts`) cho
 * lý do và luật ghim hai chiều.
 */

export * from "./tagNamespace"
export * from "./componentModel"
export * from "./hmiScreen"
