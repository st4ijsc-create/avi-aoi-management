# Golden example — Zmotion ZBasic: FOR/NEXT feeder index loop

- **id**: `zmotion-basic/feeder-index-loop`
- **kind** (programmingAdapter): `zmotion-basic`
- **tier**: A (has authoring substrate — `ZmotionBasicAdapter`)
- **code file**: [`feeder-index-loop.bas`](./feeder-index-loop.bas)

## Task prompt

- **vi**: "Viết chương trình Zmotion ZBasic dùng vòng lặp FOR/NEXT để index một feeder 5 bước,
  mỗi bước MOVE tương đối 60 đơn vị, có dwell giữa các bước."
- **en**: "Write a Zmotion ZBasic program that uses a FOR/NEXT loop to index a feeder 5 steps,
  each a relative MOVE of 60 units, with a dwell between steps."

## Why it is correct / what it passes

- **Balanced block**: one `FOR` line and one `NEXT` line → the adapter's line-count balance
  (1 open / 1 close) holds.
- Recognised motion op `MOVE` inside the loop; `WAIT IDLE` + `DELAY(ms)` sequence each index.

## Internal convention notes (what a reviewer expects)

- `FOR i = a TO b … NEXT` is the ZBasic loop; `NEXT i` (or bare `NEXT`) closes it — the adapter
  counts `NEXT`/`WEND`/`ENDIF`/`ENDSUB` as block-close **lines** and must equal the open count.
- `MOVE(dist)` is relative; `DELAY(ms)` (or `WA ms`) dwells; `WAIT IDLE` blocks on axis idle.
- Keep one block keyword per line so the line-count balance stays exact.
