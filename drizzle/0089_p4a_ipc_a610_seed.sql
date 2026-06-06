-- ============================================================================
-- Migration 0089: P4.A G11 — IPC-A-610 Rev H defect catalog full seed
--                 + i18n columns (nameVi, nameZh, descriptionVi, descriptionZh)
--                 + classRef + ipcSection columns
-- Target compliance: IPC-A-610 Class 2/3 + IATF 16949
-- Additive only. Idempotent (ON CONFLICT DO NOTHING for seeds).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Add i18n + classification columns to existing defect_catalog
-- ----------------------------------------------------------------------------
ALTER TABLE "defect_catalog"
  ADD COLUMN IF NOT EXISTS "nameVi" varchar(255),
  ADD COLUMN IF NOT EXISTS "nameZh" varchar(255),
  ADD COLUMN IF NOT EXISTS "descriptionVi" text,
  ADD COLUMN IF NOT EXISTS "descriptionZh" text,
  ADD COLUMN IF NOT EXISTS "ipcSection" varchar(20),
  ADD COLUMN IF NOT EXISTS "appliesTo" text[],
  ADD COLUMN IF NOT EXISTS "detectableBy" text[];

CREATE INDEX IF NOT EXISTS "idx_defect_catalog_ipc_section"
  ON "defect_catalog" ("ipcSection");

-- ----------------------------------------------------------------------------
-- 2) Backfill i18n for existing P2 seed rows
-- ----------------------------------------------------------------------------
UPDATE "defect_catalog" SET
  "nameVi"='Cầu thiếc', "nameZh"='锡桥',
  "ipcSection"='5', "appliesTo"=ARRAY['SMT','THT'], "detectableBy"=ARRAY['AOI','AXI']
WHERE "code"='BRIDGING';
UPDATE "defect_catalog" SET
  "nameVi"='Thiếc thiếu', "nameZh"='锡量不足',
  "ipcSection"='5', "appliesTo"=ARRAY['SMT','THT'], "detectableBy"=ARRAY['AOI','SPI','AXI']
WHERE "code"='INSUFFICIENT_SOLDER';
UPDATE "defect_catalog" SET
  "nameVi"='Thiếc thừa', "nameZh"='锡量过多',
  "ipcSection"='5', "appliesTo"=ARRAY['SMT','THT'], "detectableBy"=ARRAY['AOI','SPI','AXI']
WHERE "code"='EXCESS_SOLDER';
UPDATE "defect_catalog" SET
  "nameVi"='Mối hàn nguội', "nameZh"='冷焊',
  "ipcSection"='5', "appliesTo"=ARRAY['SMT','THT'], "detectableBy"=ARRAY['AOI']
WHERE "code"='COLD_JOINT';
UPDATE "defect_catalog" SET
  "nameVi"='Linh kiện dựng đứng (tombstone)', "nameZh"='立碑',
  "ipcSection"='8', "appliesTo"=ARRAY['SMT'], "detectableBy"=ARRAY['AOI','AXI']
WHERE "code"='TOMBSTONING';
UPDATE "defect_catalog" SET
  "nameVi"='Linh kiện dựng nghiêng (billboard)', "nameZh"='墓碑',
  "ipcSection"='8', "appliesTo"=ARRAY['SMT'], "detectableBy"=ARRAY['AOI']
WHERE "code"='BILLBOARDING';
UPDATE "defect_catalog" SET
  "nameVi"='Chân linh kiện không tiếp xúc pad', "nameZh"='引脚翘起',
  "ipcSection"='7', "appliesTo"=ARRAY['SMT','THT'], "detectableBy"=ARRAY['AOI','AXI']
WHERE "code"='LIFTED_LEAD';
UPDATE "defect_catalog" SET
  "nameVi"='Bi thiếc', "nameZh"='锡珠',
  "ipcSection"='10', "appliesTo"=ARRAY['SMT'], "detectableBy"=ARRAY['AOI']
WHERE "code"='SOLDER_BALL';
UPDATE "defect_catalog" SET
  "nameVi"='Rỗ khí trong mối hàn', "nameZh"='锡内空洞',
  "ipcSection"='5', "appliesTo"=ARRAY['SMT','BGA'], "detectableBy"=ARRAY['AXI']
WHERE "code"='VOID';
UPDATE "defect_catalog" SET
  "nameVi"='Lệch vị trí linh kiện', "nameZh"='元件偏移',
  "ipcSection"='8', "appliesTo"=ARRAY['SMT'], "detectableBy"=ARRAY['AOI']
WHERE "code"='COMPONENT_MISALIGNMENT';
UPDATE "defect_catalog" SET
  "nameVi"='Thiếu linh kiện', "nameZh"='缺件',
  "ipcSection"='8', "appliesTo"=ARRAY['SMT','THT'], "detectableBy"=ARRAY['AOI']
WHERE "code"='MISSING_COMPONENT';
UPDATE "defect_catalog" SET
  "nameVi"='Sai linh kiện', "nameZh"='错件',
  "ipcSection"='8', "appliesTo"=ARRAY['SMT','THT'], "detectableBy"=ARRAY['AOI']
WHERE "code"='WRONG_COMPONENT';
UPDATE "defect_catalog" SET
  "nameVi"='Đảo cực linh kiện', "nameZh"='极性反向',
  "ipcSection"='8', "appliesTo"=ARRAY['SMT','THT'], "detectableBy"=ARRAY['AOI']
WHERE "code"='REVERSE_POLARITY';
UPDATE "defect_catalog" SET
  "nameVi"='HiP (đầu BGA chưa hợp nhất với kem hàn)', "nameZh"='枕头效应',
  "ipcSection"='5', "appliesTo"=ARRAY['BGA'], "detectableBy"=ARRAY['AXI']
WHERE "code"='HEAD_IN_PILLOW';
UPDATE "defect_catalog" SET
  "nameVi"='Linh kiện hư hỏng/nứt vỡ', "nameZh"='元件损坏',
  "ipcSection"='9', "appliesTo"=ARRAY['SMT','THT','AVI'], "detectableBy"=ARRAY['AOI','AVI']
WHERE "code"='DAMAGED_COMPONENT';

-- ----------------------------------------------------------------------------
-- 3) Full IPC-A-610 Rev H seed — additional ~75 codes
--    Section 5 = Soldering, 6 = Terminal, 7 = Through-Hole, 8 = SMT,
--    9 = Component Damage, 10 = PCB/Assembly, 11 = Cleanliness, 12 = Marking,
--    13 = Coating, 14 = Discrete Wiring.
-- ----------------------------------------------------------------------------
INSERT INTO "defect_catalog"
  ("code","name","nameVi","nameZh","category","severity","ipcReference","ipcSection","acceptanceClass","appliesTo","detectableBy","description","descriptionVi","descriptionZh")
VALUES
  -- Section 5: Soldering
  ('NON_WETTING','Non-Wetting','Không thấm thiếc','不润湿','solder','major','5.2.2','5','2',ARRAY['SMT','THT'],ARRAY['AOI'],
   'Solder failed to wet a metal surface','Thiếc không thấm vào bề mặt kim loại','焊锡未能润湿金属表面'),
  ('DEWETTING','De-Wetting','Thiếc rút lui','缩锡','solder','major','5.2.3','5','2',ARRAY['SMT','THT'],ARRAY['AOI'],
   'Solder coated then receded leaving thinner film','Thiếc thấm rồi rút lui để lại lớp mỏng','焊锡润湿后退缩留下薄膜'),
  ('PINHOLE','Pinhole / Blowhole','Lỗ kim trong mối hàn','针孔','solder','minor','5.2.10','5','2',ARRAY['SMT','THT'],ARRAY['AOI','AXI'],
   'Small surface void in solder','Rỗ khí nhỏ ở bề mặt thiếc','焊点表面小空洞'),
  ('DISTURBED_JOINT','Disturbed Joint','Mối hàn bị xáo trộn','焊点扰动','solder','major','5.2.9','5','2',ARRAY['SMT','THT'],ARRAY['AOI'],
   'Joint moved during solidification','Mối hàn bị xê dịch khi đông cứng','焊点在凝固时受到扰动'),
  ('FRACTURED_SOLDER','Fractured Solder','Mối hàn nứt','焊点开裂','solder','critical','5.2.11','5','3',ARRAY['SMT','THT','BGA'],ARRAY['AOI','AXI'],
   'Crack in solidified solder','Vết nứt trong thiếc đã đông cứng','凝固焊锡中的裂纹'),
  ('EXPOSED_BASIS','Exposed Basis Metal','Lộ kim loại nền','基底金属外露','solder','minor','5.2.4','5','2',ARRAY['SMT','THT'],ARRAY['AOI'],
   'Base metal not protected by solder coat','Kim loại nền không được phủ thiếc','基底金属未被焊层覆盖'),
  ('SOLDER_PROJECTION','Solder Projection / Spike','Gai thiếc','锡尖','solder','minor','5.2.6','5','2',ARRAY['THT'],ARRAY['AOI'],
   'Sharp protrusion of solder','Gai nhọn của thiếc nhô ra','焊锡尖锐突起'),
  ('SOLDER_WEBBING','Solder Webbing','Mạng thiếc','锡网','solder','major','10.2','10','2',ARRAY['SMT'],ARRAY['AOI'],
   'Web of solder between conductors','Mạng thiếc giữa các đường dẫn','导体间的锡网'),
  ('SOLDER_SPLASH','Solder Splash','Bắn tóe thiếc','锡飞溅','solder','minor','10.2','10','2',ARRAY['SMT','THT'],ARRAY['AOI'],
   'Loose solder splattered on board','Thiếc văng tự do trên board','焊锡飞溅在板上'),
  ('FLUX_RESIDUE_EXCESS','Excessive Flux Residue','Cặn nhựa thông quá mức','助焊剂残留过多','contamination','minor','11.1','11','2',ARRAY['SMT','THT'],ARRAY['AOI','AVI'],
   'Flux residue beyond cleanliness spec','Cặn flux vượt quá tiêu chuẩn sạch','助焊剂残留超过清洁标准'),

  -- Section 7: Through-Hole
  ('INSUFFICIENT_HOLE_FILL','Insufficient Hole Fill','Lỗ thông không đủ thiếc','通孔填锡不足','solder','major','7.3.5','7','2',ARRAY['THT'],ARRAY['AXI'],
   'Through-hole vertical fill below spec (<75% Class 2)','Tỷ lệ lấp đầy lỗ thông dưới mức cho phép','通孔垂直填充低于规范'),
  ('NO_HOLE_FILL','No Hole Fill','Lỗ thông không có thiếc','通孔无填充','solder','critical','7.3.5','7','3',ARRAY['THT'],ARRAY['AXI'],
   'Through-hole has no solder fill','Lỗ thông hoàn toàn không có thiếc','通孔完全无焊锡'),
  ('LIFTED_PAD','Lifted Pad','Pad bị bong khỏi PCB','焊盘翘起','pcb','critical','10.5.3','10','3',ARRAY['THT'],ARRAY['AOI'],
   'Pad delaminated from PCB substrate','Pad bị tách khỏi nền PCB','焊盘从PCB基板分层'),
  ('LEAD_PROTRUSION_LONG','Lead Protrusion Too Long','Chân linh kiện thò quá dài','引脚过长','component','minor','7.3.5.5','7','2',ARRAY['THT'],ARRAY['AOI'],
   'Through-hole lead extends beyond max length','Chân linh kiện vượt quá chiều dài cho phép','引脚长度超过规定'),
  ('LEAD_PROTRUSION_SHORT','Lead Protrusion Too Short','Chân linh kiện thò quá ngắn','引脚过短','component','minor','7.3.5.5','7','2',ARRAY['THT'],ARRAY['AOI'],
   'Through-hole lead does not extend through hole','Chân linh kiện không xuyên hết lỗ','引脚未穿过通孔'),
  ('CLINCHED_LEAD','Improperly Clinched Lead','Chân uốn sai','引脚弯曲不当','component','minor','7.4','7','2',ARRAY['THT'],ARRAY['AOI'],
   'Through-hole lead bend angle out of spec','Góc uốn chân linh kiện vượt quy cách','引脚折弯角度不符合规范'),

  -- Section 8: SMT components
  ('SKEW','Component Skew','Linh kiện nghiêng/xoay','元件倾斜','component','major','8.3.2.2','8','2',ARRAY['SMT'],ARRAY['AOI'],
   'Component rotation > 50% of pad width','Linh kiện xoay quá 50% chiều rộng pad','元件旋转超过焊盘宽度50%'),
  ('SIDE_OVERHANG','Side Overhang','Lệch ra mép pad','侧面悬空','component','major','8.3.2.3','8','2',ARRAY['SMT'],ARRAY['AOI'],
   'Component side overhangs the pad beyond spec','Cạnh linh kiện thò ra ngoài pad','元件侧面超出焊盘'),
  ('END_OVERHANG','End Overhang','Lệch đầu pad','端部悬空','component','major','8.3.2.3','8','2',ARRAY['SMT'],ARRAY['AOI'],
   'Component end extends beyond pad','Đầu linh kiện thò ra ngoài pad','元件端部超出焊盘'),
  ('END_JOINT_WIDTH','End Joint Width Insufficient','Chiều rộng mối hàn đầu thiếu','端部焊点宽度不足','solder','major','8.3.5.2','8','2',ARRAY['SMT'],ARRAY['AOI','SPI'],
   'End joint width below 50% of lead width','Chiều rộng mối hàn dưới 50% chân linh kiện','端部焊点宽度低于引脚宽度50%'),
  ('SIDE_JOINT_LENGTH','Side Joint Length Insufficient','Chiều dài mối hàn cạnh thiếu','侧面焊点长度不足','solder','major','8.3.5.2','8','2',ARRAY['SMT'],ARRAY['AOI'],
   'Side joint length below required min','Chiều dài mối hàn cạnh dưới mức yêu cầu','侧面焊点长度低于要求'),
  ('UPENDED','Component Upended','Linh kiện dựng ngược','元件颠倒','component','critical','8.3.5.4','8','2',ARRAY['SMT'],ARRAY['AOI'],
   'Component standing on end','Linh kiện đứng dựng đầu','元件颠倒立起'),
  ('CHIP_OUT','Chip-Out','Sứt vỡ linh kiện','元件破损','component','major','9.4.1','9','2',ARRAY['SMT'],ARRAY['AOI','AVI'],
   'Body of chip component fractured/missing','Thân linh kiện chip bị vỡ/mất','片式元件本体破损'),

  -- BGA / leadless specific
  ('BGA_NWO','BGA Non-Wet Open','BGA không thấm/hở','BGA未润湿开路','solder','critical','5.2.5','5','3',ARRAY['BGA'],ARRAY['AXI'],
   'BGA ball did not wet pad — electrical open','Bi BGA không thấm với pad — hở mạch','BGA球未润湿焊盘形成开路'),
  ('BGA_BRIDGING','BGA Ball Bridging','Cầu giữa các bi BGA','BGA球桥接','solder','critical','5.2.5','5','3',ARRAY['BGA'],ARRAY['AXI'],
   'Adjacent BGA balls connected','Bi BGA liền kề bị nối với nhau','相邻BGA球桥接'),
  ('BGA_MISSING_BALL','BGA Missing Ball','Mất bi BGA','BGA缺球','component','critical','8.3.12','8','2',ARRAY['BGA'],ARRAY['AXI'],
   'BGA package missing one or more balls','BGA thiếu một hoặc nhiều bi','BGA封装缺少一个或多个球'),
  ('BGA_VOID_HIGH','BGA Void > Class Limit','Rỗ BGA vượt giới hạn','BGA空洞超标','solder','major','5.2.12','5','3',ARRAY['BGA'],ARRAY['AXI'],
   'Single ball void > 25% (Class 2) or 9% (Class 3)','Rỗ trong bi BGA vượt giới hạn theo Class','单球空洞超过等级限制'),
  ('BGA_BALL_DEFORMED','BGA Ball Deformed','Bi BGA biến dạng','BGA球变形','component','major','9.4','9','3',ARRAY['BGA'],ARRAY['AXI','AVI'],
   'BGA ball shape distorted','Hình dạng bi BGA bị méo','BGA球形状变形'),
  ('QFN_INSUFFICIENT','QFN Pad Insufficient Wetting','QFN pad không đủ thấm','QFN焊盘润湿不足','solder','major','8.3.10','8','2',ARRAY['QFN'],ARRAY['AXI'],
   'QFN center thermal pad insufficient solder coverage','Pad nhiệt trung tâm QFN không đủ thiếc','QFN中心散热焊盘焊锡不足'),

  -- Section 9: Component Damage
  ('CRACKED_PACKAGE','Cracked Package','Vỏ linh kiện nứt','封装破裂','component','critical','9.4','9','3',ARRAY['SMT','THT'],ARRAY['AOI','AVI'],
   'Component package has crack','Vỏ linh kiện có vết nứt','元件封装有裂纹'),
  ('BENT_LEAD','Bent Lead','Chân linh kiện cong','引脚弯曲','component','major','9.5','9','2',ARRAY['SMT','THT'],ARRAY['AOI','AVI'],
   'Component lead bent beyond spec','Chân linh kiện cong vượt cho phép','元件引脚弯曲超规'),
  ('COPLANARITY_FAIL','Lead Coplanarity Out','Đồng phẳng chân kém','引脚共面性差','component','major','8.3.5.3','8','2',ARRAY['SMT'],ARRAY['AOI','3D'],
   'Lead coplanarity exceeds spec','Đồng phẳng chân vượt quy cách','引脚共面性超出规范'),

  -- Section 10: PCB & Assembly
  ('SCRATCH','Scratch on PCB','Trầy xước PCB','PCB划痕','pcb','minor','10.2.1','10','2',ARRAY['PCB'],ARRAY['AVI'],
   'Surface scratch on PCB substrate','Vết trầy trên bề mặt PCB','PCB基板表面划痕'),
  ('CONTAMINATION_PARTICLE','Particulate Contamination','Bụi bẩn ngoại lai','颗粒污染','contamination','minor','11.1','11','2',ARRAY['PCB'],ARRAY['AVI'],
   'Foreign particle on PCB','Hạt bụi lạ trên PCB','PCB上有外来颗粒'),
  ('FOD','Foreign Object Debris','Vật lạ trên board','异物碎屑','contamination','major','11.1','11','3',ARRAY['PCB'],ARRAY['AVI','AOI'],
   'Loose foreign object on assembly','Vật ngoại lai rời trên cụm','装配上有松散异物'),
  ('EXPOSED_COPPER','Exposed Copper','Lộ đồng','铜外露','pcb','minor','10.3','10','2',ARRAY['PCB'],ARRAY['AOI','AVI'],
   'Solder mask missing — copper exposed','Mặt nạ hàn mất — lộ đồng','阻焊缺失露铜'),
  ('SOLDER_MASK_DAMAGE','Solder Mask Damage','Hỏng mặt nạ hàn','阻焊损伤','pcb','minor','10.3.2','10','2',ARRAY['PCB'],ARRAY['AOI','AVI'],
   'Solder mask scratched or peeled','Mặt nạ hàn bị trầy/bong','阻焊层划伤或脱落'),
  ('MEASLING','Measling','Lỗ trắng nội tại PCB','PCB分层斑点','pcb','major','10.5.1','10','2',ARRAY['PCB'],ARRAY['AVI'],
   'White spots between weave/resin','Đốm trắng giữa sợi/nhựa PCB','PCB纤维与树脂间白点'),
  ('DELAMINATION','Delamination','Tách lớp PCB','PCB分层','pcb','critical','10.5.2','10','3',ARRAY['PCB'],ARRAY['AVI','AXI'],
   'PCB layer separation','Tách lớp giữa các lớp PCB','PCB层间分离'),
  ('WEAVE_EXPOSURE','Weave Exposure','Lộ sợi PCB','纤维外露','pcb','minor','10.5','10','2',ARRAY['PCB'],ARRAY['AVI'],
   'Glass weave exposed','Lộ sợi thủy tinh','玻璃纤维外露'),
  ('BURN_MARK','Burn Mark','Vết cháy','烧痕','pcb','major','10.6','10','2',ARRAY['PCB','SMT'],ARRAY['AVI'],
   'Discoloration from heat damage','Đổi màu do nhiệt','热损伤变色'),
  ('CONFORMAL_VOID','Conformal Coating Void','Thiếu lớp phủ','保形涂层缺失','coating','major','13.1.4','13','2',ARRAY['PCB'],ARRAY['AVI'],
   'Conformal coating coverage gap','Khe hở lớp phủ bảo vệ','保形涂层覆盖缺口'),
  ('CONFORMAL_BUBBLE','Conformal Coating Bubble','Bọt khí trong lớp phủ','保形涂层气泡','coating','minor','13.1.5','13','2',ARRAY['PCB'],ARRAY['AVI'],
   'Air bubble trapped in conformal coating','Bọt khí trong lớp phủ bảo vệ','保形涂层中气泡'),
  ('POOR_MARKING','Poor / Illegible Marking','In dấu mờ/sai','标识模糊','marking','minor','12.2','12','2',ARRAY['PCB','COMPONENT'],ARRAY['AVI','OCR'],
   'Marking unreadable or wrong','Dấu in không đọc được hoặc sai','标识无法识读或错误'),
  ('WRONG_PART_NUMBER','Wrong Part Number Marking','Sai số chi tiết in trên linh kiện','零件号错误','marking','critical','12.1','12','2',ARRAY['COMPONENT'],ARRAY['AVI','OCR'],
   'Component marking does not match BOM','Mã in không khớp BOM','元件标识与BOM不符'),

  -- Section 14: Discrete wiring (mainly mechanical/AVI)
  ('WIRE_INSULATION_DAMAGE','Wire Insulation Damage','Hỏng vỏ cách điện dây','线缆绝缘损伤','wiring','major','14.2','14','2',ARRAY['WIRING'],ARRAY['AVI'],
   'Insulation cut/abraded','Vỏ cách điện bị cắt/mòn','绝缘层切割或磨损'),
  ('CRIMP_BAD','Bad Crimp Connection','Bóp dây cốt sai cách','压接不良','wiring','major','14.3','14','2',ARRAY['WIRING'],ARRAY['AVI'],
   'Crimp does not meet pull-test spec','Mối bóp không đạt test kéo','压接不满足拉力测试规范'),

  -- Mechanical AVI / Cosmetic (for non-PCB products)
  ('SURFACE_DENT','Surface Dent','Lõm bề mặt','表面凹陷','mechanical','major','MECH-1','MECH','2',ARRAY['MECH','HOUSING'],ARRAY['AVI','3D'],
   'Indentation on mechanical surface','Vết lõm trên bề mặt cơ khí','机械表面凹痕'),
  ('SURFACE_BURR','Surface Burr','Bavia/gờ thừa','毛刺','mechanical','major','MECH-2','MECH','2',ARRAY['MECH','HOUSING'],ARRAY['AVI','3D'],
   'Sharp burr from machining/punching','Bavia sắc từ gia công','机加工产生的尖锐毛刺'),
  ('EDGE_CHIP','Edge Chip-Out','Sứt mép','边缘缺口','mechanical','major','MECH-3','MECH','2',ARRAY['MECH'],ARRAY['AVI'],
   'Material chipped from edge','Vật liệu bị sứt ở cạnh','边缘材料破损'),
  ('SCRATCH_COSMETIC','Cosmetic Scratch','Trầy xước thẩm mỹ','外观划痕','cosmetic','minor','COSM-1','COSM','2',ARRAY['HOUSING','COSMETIC'],ARRAY['AVI'],
   'Scratch in cosmetic zone','Trầy ở vùng thẩm mỹ','外观区域划痕'),
  ('COLOR_MISMATCH','Color Mismatch','Sai màu','颜色不匹配','cosmetic','major','COSM-2','COSM','2',ARRAY['HOUSING','COSMETIC'],ARRAY['AVI','SPECTRO'],
   'Color delta-E exceeds spec','Sai số màu vượt giới hạn','色差ΔE超出规范'),
  ('GLOSS_OUT','Gloss Out of Spec','Độ bóng sai','光泽度超规','cosmetic','minor','COSM-3','COSM','2',ARRAY['HOUSING','COSMETIC'],ARRAY['AVI','GLOSS'],
   'Surface gloss outside acceptable range','Độ bóng bề mặt ngoài dải cho phép','表面光泽度超出范围'),
  ('GASKET_MISSING','Gasket / Seal Missing','Thiếu joăng/seal','密封圈缺失','assembly','critical','MECH-4','MECH','3',ARRAY['ASSEMBLY'],ARRAY['AVI'],
   'Gasket missing or discontinuous','Joăng/seal thiếu hoặc đứt','密封圈缺失或不连续'),
  ('ENGRAVING_LOW_CONTRAST','Engraving Low Contrast','Khắc laser mờ','激光雕刻对比度低','marking','minor','MARK-1','MARK','2',ARRAY['HOUSING'],ARRAY['AVI','OCR'],
   'Laser/ink mark contrast below threshold','Tương phản dấu khắc thấp hơn ngưỡng','激光或油墨标识对比度过低'),
  ('OCR_FAIL','OCR Read Failure','Đọc OCR không thành công','OCR识别失败','marking','major','MARK-2','MARK','2',ARRAY['PCB','COMPONENT','HOUSING'],ARRAY['OCR'],
   'OCR confidence below required threshold','Độ tin cậy OCR dưới ngưỡng','OCR可信度低于阈值'),

  -- 3D / Geometric
  ('HEIGHT_OUT','Height Out of Tolerance','Chiều cao ngoài dung sai','高度超出公差','3d','major','3D-1','3D','2',ARRAY['SMT','MECH'],ARRAY['3D','SPI'],
   'Measured height outside tolerance','Chiều cao đo ngoài dung sai','测量高度超出公差'),
  ('VOLUME_OUT','Volume Out of Tolerance','Thể tích ngoài dung sai','体积超出公差','3d','major','3D-2','3D','2',ARRAY['SPI'],ARRAY['SPI'],
   'Solder paste volume out of tolerance','Thể tích kem hàn ngoài dung sai','焊膏体积超出公差'),
  ('WARPAGE_HIGH','PCB Warpage High','PCB cong vênh','PCB翘曲过大','3d','major','3D-3','3D','2',ARRAY['PCB'],ARRAY['3D'],
   'Board warpage exceeds spec','Cong vênh board vượt quy cách','板翘曲超出规范'),
  ('TILT_HIGH','Component Tilt High','Linh kiện nghiêng mặt phẳng','元件倾斜超规','3d','major','3D-4','3D','2',ARRAY['BGA','QFN'],ARRAY['3D','AXI'],
   'Component tilt exceeds spec','Độ nghiêng mặt linh kiện vượt quy cách','元件倾斜度超出规范'),
  ('FLATNESS_OUT','Flatness Out','Độ phẳng ngoài dung sai','平面度超差','3d','major','3D-5','3D','3',ARRAY['MECH'],ARRAY['3D','CMM'],
   'GD&T flatness out of spec','Độ phẳng GD&T vượt dung sai','GD&T平面度超出规范'),
  ('PARALLELISM_OUT','Parallelism Out','Độ song song ngoài dung sai','平行度超差','3d','major','3D-6','3D','3',ARRAY['MECH'],ARRAY['3D','CMM'],
   'GD&T parallelism out of spec','Độ song song GD&T vượt dung sai','GD&T平行度超出规范'),
  ('PERPENDICULARITY_OUT','Perpendicularity Out','Độ vuông góc ngoài dung sai','垂直度超差','3d','major','3D-7','3D','3',ARRAY['MECH'],ARRAY['3D','CMM'],
   'GD&T perpendicularity out of spec','Độ vuông góc GD&T vượt dung sai','GD&T垂直度超出规范'),
  ('TRUE_POSITION_OUT','True Position Out','Vị trí thực ngoài dung sai','位置度超差','3d','critical','3D-8','3D','3',ARRAY['MECH'],ARRAY['3D','CMM'],
   'GD&T true position out of spec','Vị trí thực GD&T vượt dung sai','GD&T真实位置超出规范'),
  ('CIRCULARITY_OUT','Circularity Out','Độ tròn ngoài dung sai','圆度超差','3d','major','3D-9','3D','3',ARRAY['MECH'],ARRAY['3D','CMM'],
   'GD&T circularity out of spec','Độ tròn GD&T vượt dung sai','GD&T圆度超出规范'),
  ('CYLINDRICITY_OUT','Cylindricity Out','Độ trụ ngoài dung sai','圆柱度超差','3d','major','3D-10','3D','3',ARRAY['MECH'],ARRAY['3D','CMM'],
   'GD&T cylindricity out of spec','Độ trụ GD&T vượt dung sai','GD&T圆柱度超出规范'),

  -- Test / Electrical (for cross-station triangulation)
  ('OPEN_CIRCUIT','Open Circuit','Hở mạch','开路','electrical','critical','ELEC-1','ELEC','3',ARRAY['SMT','THT'],ARRAY['ICT','FCT'],
   'Electrical open detected','Phát hiện hở mạch','检测到电路开路'),
  ('SHORT_CIRCUIT','Short Circuit','Ngắn mạch','短路','electrical','critical','ELEC-2','ELEC','3',ARRAY['SMT','THT'],ARRAY['ICT','FCT'],
   'Electrical short detected','Phát hiện ngắn mạch','检测到电路短路'),
  ('RESISTANCE_OUT','Resistance Out of Range','Điện trở ngoài dải','电阻超范围','electrical','major','ELEC-3','ELEC','2',ARRAY['SMT','THT'],ARRAY['ICT'],
   'Component resistance out of expected range','Điện trở linh kiện ngoài dải kỳ vọng','元件电阻超出预期范围'),
  ('CAPACITANCE_OUT','Capacitance Out of Range','Điện dung ngoài dải','电容超范围','electrical','major','ELEC-4','ELEC','2',ARRAY['SMT'],ARRAY['ICT'],
   'Component capacitance out of expected range','Điện dung linh kiện ngoài dải kỳ vọng','元件电容超出预期范围')
ON CONFLICT ("code") DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4) Audit log entry for the seed
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='audit_logs') THEN
    INSERT INTO "audit_logs"
      ("userName","action","entityType","entityId","entityName","details","status","createdAt")
    VALUES
      ('system', 'seed', 'defect_catalog', 0,
       'IPC-A-610 Rev H seed (P4.A G11)',
       '{"migration":"0089","target":"IPC-A-610 Class 2/3 + IATF 16949"}',
       'success', NOW());
  END IF;
END $$;
