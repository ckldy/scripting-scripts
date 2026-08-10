# 原版数值图层契约（只读归档提取）

来源仅限工作区 `original-archive/` 的公开生产包：`app.js`、`chunk-3be92626.js`、`chunk-21b889af.js`。本文不推断归档中不存在的实现。

## 1. 请求与时间轴

- GFS 时间轴：`https://datacenter.istrongcloud.com/data/gfsimgv4/06_time_{type}.json`
- ECMWF 时间轴：`https://datacenter.istrongcloud.com/data/ecmwfv4/06_time_{type}.json`
- 时间轴响应：`{ updatetime, time, data, base_url }`
- `data[]` 帧字段：`{ url, time, img_url }`
- 每帧并行读取：
  - `{base_url}/{url}`：网格头 JSON
  - `{base_url}/{img_url}`：RGBA PNG 数值载体
- 原版时间轴初始化：按原数组顺序；从前 9 帧中选距离当前时刻最近且已到达的帧并置于轴首，同时保留未来帧。非会员只能前进到受限位置，会员可完整切换。

## 2. PNG 与网格头解码

网格头字段：

`lo1, la1, lo2, la2, dx, dy, nx, ny, minr, maxr, ming, maxg, minb, maxb, date`

像素 `i` 的原版解码：

```text
A == 0          => 无数据
u = R / 255 × (maxr - minr) + minr
v = G / 255 × (maxg - ming) + ming
s = B / 255 × (maxb - minb) + minb
maxb == 0       => s 为 null
```

关键结论：**B 通道不是统一的 0–1 色阶索引**。R/G/B 分别编码 u、v、标量 s；色阶输入是解码后的 `s`，缺少 s 时才使用 `sqrt(u²+v²)`。旧实现直接 `B/255` 再套统一伪色，破坏了真实值域，是当前伪色错误的根因。

网格定位与插值：

```text
x = floorMod(lng - lo1, 360) / dx
y = (la1 - lat) / dy
```

原版对四个相邻网格值做双线性插值；全球闭合网格在 `floor(nx × dx) >= 360` 时将每行首值追加到行尾。

## 3. 产品契约

| UI 产品 | 时间轴 type | Windy dataType | 标量/详情 | 单位 | 小数 | quota | overlay alpha | 动画 |
|---|---|---|---|---:|---:|---:|---:|---|
| 风场 | `wind_surface` | `wind` | s 或风速模 | m/s | 0 | 1 | 150 | 原版配置 `drawAnimation:false` |
| 浪场 | `wave_surface` | `ocean` | s | m | 2 | 1 | 150 | 原版 Windy ocean 参数支持动画 |
| 温度 | `tmp_surface` | `temp` | s | ℃ | 1 | 1 | 150 | 否 |
| 水汽含量 | `pwater_surface` | `water` | s | kg/㎡ | 3 | 1 | 150 | 否 |
| 云中总水量 | `cwater` | `cloudWater` | s | kg/㎡ | 3 | 1 | 150 | 否 |
| 海平面气压 | `mslp`（组件声明） | `mslp` | s / 100 | hpa | 0 | 100 | 150 | 归档没有 `mslp` 色阶 |

归档中的高度场 `500hPa/850hPa` 由独立异步 `Wpsh` 组件负责；对应 chunk 未在归档中，因此其请求、解码、等值线和色阶契约不能从现有归档完整恢复，禁止套用通用 B 通道伪色。

## 4. 原版色阶

### wind

- bounds：`[0, 24]`
- 使用 `extendedSinebowColor(min(value, 100) / 100, alpha)`，不是分段表。

### ocean

```json
[[0,[8,29,88]],[1,[37,52,148]],[2,[34,94,168]],[3,[29,145,192]],[4,[65,182,196]],[5,[127,205,187]],[6,[199,233,180]],[7,[237,248,177]],[8,[254,204,92]],[10,[253,141,60]],[12,[240,59,32]],[14,[189,0,38]]]
```

### temp

```json
[[-40,[229,229,229]],[-30,[243,164,243]],[-20,[140,15,140]],[-15,[41,30,105]],[-10,[86,79,171]],[-5,[65,119,190]],[0,[13,122,26]],[5,[68,173,7]],[10,[188,227,33]],[15,[250,221,50]],[20,[248,163,25]],[25,[231,80,20]],[30,[203,11,60]],[40,[88,27,67]],[50,[43,0,1]]]
```

### water

```json
[[0,[230,165,30]],[10,[120,100,95]],[20,[40,44,92]],[30,[21,13,193]],[40,[75,63,235]],[60,[25,255,255]],[70,[150,255,255]]]
```

### cloudWater

```json
[[0,[5,5,89]],[0.2,[170,170,230]],[1,[255,255,255]]]
```

色阶段内采用 RGB 线性插值并向下取整；超出端点时夹紧到端点色。默认 overlay alpha 为 153，产品传入 `OVERLAY_ALPHA:150` 后使用 150。

## 5. 原版 Windy 动画参数

### wind

- `PARTICLE_LINE_LENGTH .16`
- `PARTICLE_LINE_WIDTH 1`
- `PARTICLE_MULTIPLIER .02`
- `PARTICLE_OPACITY 1`
- `PARTICLE_REDUCTION 1.1447142425533319`
- `VELOCITY_SCALE .011447142425533319`
- `FRAME_RATE 15` / `FRAME_TIME 66.66666666666667`
- `MAX_PARTICLE_AGE 90`
- 白色粒子

### ocean

- `PARTICLE_LINE_LENGTH .8`
- `PARTICLE_LINE_WIDTH 7`
- `PARTICLE_MULTIPLIER .05`
- `PARTICLE_OPACITY 1`
- `FRAME_TIME 40`
- `VELOCITY_SCALE .06`
- `MAX_PARTICLE_AGE 100`
- 白色粒子
- 粒子数按 `width × height × multiplier / 1.65^(zoom-1)` 计算

## 6. 当前实现边界

本轮已按归档恢复：RGB 数值解码、透明像素无数据、产品独立色阶、150 alpha、公开时间轴类型。当前 GridLayer 仍使用近邻采样；原版是屏幕空间双线性插值与投影畸变校正。该差异影响平滑度，不再造成统一 B 通道伪色。

因归档缺失独立渲染契约，当前明确禁用 `云中总水量`、`500hPa高度`、`850hPa高度`、`海平面气压` 的错误通用渲染，而不是继续伪造色阶。
