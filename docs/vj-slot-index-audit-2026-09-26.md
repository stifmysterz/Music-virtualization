# VJ 隧道「按槽位编号取外观」排查(2026-09-26)

基于 commit `047a7df` 的 `61.html`(行号以该版本为准)。

## 问题是什么

槽位循环的写法是 `z = -i*SPACING + off - SPACING`,`off = scroll % SPACING`。元素走过一个间距后全体退一格,由后面的槽位接上,所以**位置**是无缝的。但凡是按**槽位编号 `i`** 决定的外观(建场景时按 `i` 存的随机值、`i%N` 的交替、直接加 `i` 的角度),每次退格都会留在原槽位上,于是同一个物理元素的外观突然变成邻居的样子。退格大约每 2~4 帧一次,所以看起来是持续的闪烁或抖动。

SpeedGates(橙色强调门原地频闪)和 NeonTubeRoom(方环回跳)已在第 0 轮修好。

## 修法(通用)

元素的**世界编号**在它从远端进来、到从镜头前离开的整个生命里是不变的:

```js
const wraps = Math.floor(scroll / SPACING);
const id = ((i + wraps) % COUNT + COUNT) % COUNT;   // COUNT = 槽位总数
```

凡是按元素决定的外观都改用 `id`,实例下标(`setMatrixAt` / `setColorAt` 的第一个参数)仍然用 `i`。取 `% N` 交替时,**N 必须整除 COUNT**,否则每圈循环首尾对不上。

修完在 `app/tests/vj-element-continuity.spec.js` 里给这条隧道加一个 `pick`(照 SpeedGates / NeonTubeRoom 的写法),先用旧写法看它失败,再改。

## 更正(第 3 批验收时)

这份排查**漏了 3 条**:DerelictHall(坍塌段 `gone[idx]`、倾斜 `tilt[i]`)、CollapsedGrid(断梁 `broke[idx]`、`drop[idx]`)、DustShaft(光柱位置 `sx[i]`、粗细 `sw[i]`)。都是建场景时用随机数按槽位存、更新时按槽位读 —— 和 HoverCity 同一类。第 3 批时 ChatGPT 发现并修好了,也加了连续性测试。下面「没问题的」那一节原来的结论因此不成立。

复查方法(不再靠人眼逐行):对全部 50 条,找出建场景时用 `Math.random` 填的数组,列出更新阶段每一处按非世界编号的下标读取它们的地方,再逐条判断。结果:除上面 3 条(已修)外,只剩本文已列的 FoilCrumple;其余命中都是元素自带 z、单独回收的数组(CoasterRush 的彩灯、SolarFlare 的光弧、DustShaft 的灰尘),不受槽位影响。HexPulse 的 `(i%2)` 属于「建场景时按槽位算好存进对象」,这类另用关键字扫过,只有它一条。

## 确认的 4 条(另见上方更正里的 3 条)

| 隧道 | 批次 | 行 | 现在的写法 | 看到的现象 | 改法 |
|---|---|---|---|---|---|
| vjCubeMatrix | 3 | 15630 | `e.set(clock*0.6 + j, clock*0.45 + i, a)` | 每次退格所有方块绕 y 轴突跳约 57°(1 弧度) | `clock*0.45 + id`,`id` 对 `RINGS` 取模 |
| vjHoverCity | 3 | 16057、16067 | `seed[t]`,`t = i*2+sgn`(每栋楼的高度 `h`、高度位置 `y`、窗色 `lit` 都是按槽位存的随机值);窗户闪烁 `on` 也用 `t` | 每次退格所有楼的高度、位置、窗色都变成另一栋的 | 取 seed 用 `id*2+sgn`(`id` 对 `COLS` 取模),窗户闪烁的 `t` 也换成它;`vjPut`/`setColorAt` 的下标仍用 `t` |
| vjHexPulse | 4 | 15158、15178 | 建场景时 `loop.rotation.z = (i%2)*(Math.PI/6)` 存进 `baseRot` | 每次退格每个六边形转 30°(尖头朝上 ↔ 平边朝上),节点跟着转 | 更新时用 `((i + wraps) % 2) * Math.PI/6` 代替 `r.baseRot`(`RINGS=56`,能被 2 整除) |
| vjFoilCrumple | 5 | 16916~16917、16939~16942 | `rot[idx*3…]`、`phase[idx]`,`idx = i*PER + j`(每片的朝向和闪光相位按槽位存) | 每次退格所有锡箔片突然换朝向,闪光位置也跳 | 读 `rot`/`phase` 用 `sid = id*PER + j`(`id` 对 `RINGS` 取模);`vjPut`/`setColorAt` 仍用 `idx` |

## 没问题的

- ~~26 条槽位循环隧道里,其余 20 条只用 `i` 算位置、`wz` 或实例下标(已逐行核对)。~~ 不成立,见上方更正。
- 14 条是「每个元素自己回收」(`s.z -= VJ_LEN`),元素自带状态,不受槽位影响。
- 10 条不是槽位循环。
- 另外逐处核对了槽位隧道以外的 6 处 `i%N` / `k%N` 写法:RustPipes 的法兰(`k%5`,元素用 `vjLoopZ` 自带偏移,编号跟着元素走)、NeonReactorDescent 的墙面和粒子(按相位采样,编号就是元素本身)、金色水池(3 个固定物体)、刻度环(建场景时一次画好)。都没有问题。

## 另一个相关问题(本轮未改,HANDOFF 已记录)

同样这 26 条里,`wz = i*SPACING - scroll` 也不是物理坐标:每次退格它对同一个元素跳 −SPACING,所以用 `wz` 驱动的摆动、旋转、波形在退格时有小幅阶跃(比 1 弧度的突跳小得多,但同一类原因)。物理上连续的写法是用 `id`(或 `(i + wraps) * SPACING`)代替 `i*SPACING`。这会改变现有的运动节奏,要不要改由用户决定。
