# 大温哥华人口地图 / Metro Vancouver Census Atlas

沿用 [Calgary](https://github.com/curtisatiwatt/calgary-census) 和 [Edmonton](https://github.com/curtisatiwatt/edmonton-census) 项目的地图交互，从熟悉的社区名字查找大温哥华人口、族裔及住户收入。

## 功能

- **人口构成**：社区详情保留各市府原始族裔分类；没有指定来源顺序时按公布人数或百分比降序排列。细分普查详情默认显示原表全部类别；地图对比使用同口径的 13 个联邦普查类别。
- **分布对比**：使用统一色阶比较不同群体的地理分布，地图位置和缩放保持同步。
- **收入底色**：优先使用社区本身公布的家庭收入，中位数用实色、只有平均数时用斜纹。没有同范围市府值时保留各 CT 的收入底色，不平均中位数。
- **具名社区优先**：默认以市府社区名称定位，搜索 Kitsilano、Steveston、Metrotown、Maillardville 等直接进入社区概况。缩放或开启收入／族裔图层后仍可整块点选社区。市府缺少的项目自动显示当前位置的普查补充资料，注明范围，无需额外进入街区统计。
- **统一搜索**：搜索社区、市镇、普查区编号或 SkyTrain 车站。车站结果显示所属线路，选中自动开启 SkyTrain 并定位；不会把车站当成人口统计区域。
- **中英文、浅色／深色／跟随系统**，适配电脑与手机，支持可拖动的手机详情面板。
- 内置海岸、水域、主要道路和地理背景，无需地图 API key 或外部瓦片服务。
- **SkyTrain 线路与车站**：在“地图图层”中独立开关 Expo、Millennium、Canada 三条运营线路与 54 座车站，默认关闭。保留机场、Richmond、Surrey 等支线，换乘站合并显示；点击车站可查看名称和所属线路，放大显示更多站名。

## 数据范围与口径

### 市府具名社区

截至本次整理，接入 **165 个具名社区／规划区域**，为 **450 个 CT** 提供已核对的地名参照。数据保存在 `public/data/neighbourhoods.json`，原始快照、统计表定位信息、来源与许可在 `data/source/municipal-neighbourhoods/`；构建及连接审计在 `data/audit/neighbourhoods.json`。

| 市镇 | 地区数 | 社区资料 |
| --- | ---: | --- |
| Vancouver | 22 | 20 区已核对 2021 人口、族裔百分比和 2020 家庭收入中位数；Strathcona、West End 新版值暂缺 |
| Richmond | 15 | 具名规划区资料与可点击的普查街块近似范围；East Richmond / Fraser Lands 联合人口、分别收入，不合并中位数 |
| Burnaby | 20 | 官方 Community Plan Areas；未找到匹配这些现行边界的完整 2021 社区表 |
| Coquitlam | 13 | 官方 Community Profile Areas；已找到的细分报告使用 2016 数据，未冒充 2021 |
| Surrey | 7 | 2021 公布人口、2020 **平均**家庭收入；族裔仅原表公布分类。Fleetwood 图文冲突的族裔值留空 |
| New Westminster | 15 | 官方 2021 社区表；Brunette Creek 的长表值受抑制 |
| North Vancouver (District) | 45 | 官方 2021 社区表；保留原始舍入差异及抑制值 |
| Langley (City) / Langley (Township) | 6 / 11 | 官方具名区域，尚无已核对的同范围统计 |
| Delta | 11 | 官方具名区域，尚无已核对的同范围统计 |

社区资料卡保留每项的实际年份、统计基数、平均／中位数及原分类。缺失不会填零，也不会借用附近 CT 的数据作为整个社区统计。默认地图提供社区边界与名称；收入优先来自同范围市府资料，族裔分布图仍采用下述统一 CT 统计。补充统计独立标明所选位置和 CT 编号；鼠标用实际点击位置，搜索和键盘使用社区内的定位点。没有已接入社区参照的地方保留原普查区名称，不表示当地不存在具名社区。

Richmond 的市府资料快照保留社区名称、单个定位点、统计摘要及 CT 位置关系，不公开复制未确认开放再分发许可的市府 GIS 多边形。可点击范围另由 Statistics Canada 开放许可的 2021 普查街块（DB）组合而成，标为“社区定位范围（按普查边界近似）”。921 个街块的公开几何及社区归属事实保存在 `richmond-census-blocks.geojson`，离线构建不读取原市府边界。它们只用于定位，不用于合计人口或收入。多数范围与市府规划区很接近，但 Bridgeport、Shellmont 和 South Arm Islands 的工业地及岛屿范围仍有明显差异；完整官方范围以市府地图为准。East Richmond 和 Fraser Lands 的收入填色分别使用各自公布的收入和近似范围，不计算联合中位数。其余社区使用各市开放资料。原住民地区保留独立地理身份，不作为邻近市政府管辖社区。DNV 和 Langley Township 的命名多边形主要覆盖居住聚落，未给山林或乡村编造社区边界。

### 统一细分统计

本项目使用 Statistics Canada **2021 年 Vancouver Census Metropolitan Area（CMA 933）的 535 个 Census Tracts（CT，普查分区）**。此版官方边界与 Greater Vancouver Census Division（CD 5915）范围一致，涵盖 Vancouver、Richmond、Burnaby、Surrey、Coquitlam、North/West Vancouver、Delta、Langley、Maple Ridge、White Rock、Bowen Island 等地区。

38 个 Census Subdivisions（CSD）包括市镇、原住民地区和选举地区，**不代表 38 座城市**。CT 是统计边界，不等同于房地产社区、行政社区或学区。城市／地区名称仅辅助定位；跨 CSD 的 CT 保留完整统计边界，不能将一整个 CT 的统计值当作某个市镇的精确汇总。

- **总人口**：2021 年 100% 普查计数，包括集体住所居民；区域总人口 **2,642,825**。
- **族裔分类**：使用官方 visible minority / racialized population 表的 13 类互斥分类，属于 25% 长表加权估计。占比使用**同表私人住户人口**作为分母，大温分母为 **2,607,010**。它与总人口和短表私人住户人口不同。
- **Chinese** 是普查分类，不等于中国国籍、中国出生、中文使用者或所有具华人祖源者。“Not a visible minority”包含原住民等人口，不能改称白人或欧洲裔。
- **收入**：2020 年私人住户税前总年收入中位数，单位 CAD，采用 Census Profile 的 **100% 数据**。大温整体中位数 **$90,000** 直接取官方区域值，未对 CT 中位数求平均。它不是个人工资、税后收入或当前收入。
- **儿童占比**：采用官方直接发布的 0–14 岁占比，统计基数为年龄统计人口。平均住户人数采用官方直接发布值。
- **缺失与取整**：抑制、不适用和未发布数据保留为空；公布的 0 保留为 0。缺失不代表低收入或没有居民。人数随机取整可使分类合计与分母略有差异，圆环单独表示差额；所有数值与分布图仍使用原表分母。

人口年份和收入参考年份始终在数据说明中标明。这是官方资料快照，不是实时人口或收入预测。

SkyTrain 使用 TransLink **2026-11-06** 官方 GTFS 运营快照，与人口普查年份独立。轨迹来自真实班次形状，站点采用官方 parent station 坐标，不是车站入口或步行导航；不提供实时到站、班次及服务中断信息。Broadway Subway 和 Surrey–Langley 未开放扩建不画作运营线路，SeaBus 和 West Coast Express 不包含在此图层。

## 本地开发

Node.js 24（最低 22.12）+ Vite + Leaflet。常规运行无需 Python、数据库或密钥。

```sh
npm ci
npm run dev
```

```sh
npm run check
npm run build
npm run preview
```

静态资源采用相对路径，兼容根目录和 GitHub Pages 的 `/vancouver-census/` 子路径。GitHub Actions 在 `main` 更新后校验并发布 `dist/`；Pages 的 Source 需要设为 **GitHub Actions**。

## 数据维护

应用运行时仅读取 `public/data/` 中的本地快照。`scripts/build-data.py` 与 `scripts/build-geography.py` 是联网更新数据的维护脚本，不是网站运行依赖。来源、字段映射、连接规则和覆盖审计保存在 `data/`，展示元数据在 `public/data/metadata.json`。

普查快照可离线重建，或从官方来源刷新：

```sh
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements-data.txt
.venv/bin/python scripts/build-data.py            # 从仓库快照重建
.venv/bin/python scripts/build-data.py --refresh  # 联网刷新官方资料
```

地理背景的原始文件体积较大，不随仓库存储；可从官方服务下载至本地缓存并重建：

```sh
.venv/bin/python scripts/build-geography.py --source-dir .data-cache/geography --download
.venv/bin/python scripts/build-data.py  # 合并地理来源，更新避水标注点
```

保留缓存后，省略 `--download` 即可从相同原始文件重建。快照日期可通过 `--snapshot-date YYYY-MM-DD` 指定。

SkyTrain 数据脚本只需 Python 3.9+ 标准库。仓库保留了相关官方 GTFS 行，可离线逐坐标重建：

```sh
python3 scripts/build-skytrain.py
# 联网更新时，指定所需运营日期（日期必须在下载的 feed 服务区间内）：
python3 scripts/build-skytrain.py --refresh --snapshot-date YYYY-MM-DD
.venv/bin/python scripts/build-data.py  # 合并交通数据说明和来源
```

刷新后必须运行 `npm run check`，并复核来源版本、地理范围、数据口径和缺失值。

具名社区从保留的市府快照离线重建：

```sh
.venv/bin/python scripts/build-neighbourhoods.py
```

该脚本只建立名称、定位点与几何关系，不重算人口、族裔人数或收入。市府资料新增时应先核对边界、统计年份、基数及许可，再更新 `*-profiles.json`。Richmond 的市府资料快照保持点几何，构建时组合独立的公开普查街块快照生成近似定位范围，不能描述为官方社区边界。源快照附普查服务链接、许可、归属方法及对照评估，构建审计记录其校验值。

## 来源与许可

统计资料改编自 [Statistics Canada 2021 Census Profile](https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/index.cfm?Lang=E)，通过其官方 SDMX API 获取，依据 [Statistics Canada Open Licence](https://www.statcan.gc.ca/en/reference/licence) 使用。本产品不代表 Statistics Canada 的认可。

地图背景采用 British Columbia 官方开放地理资料；具体服务、查询和许可见地理审计及应用数据说明。Leaflet 的 BSD-2-Clause 许可保存在 `public/licenses/leaflet.txt`。本仓库基于同一作者的 Calgary / Edmonton 项目改编，第三方许可不改变项目自有代码的权利归属。

SkyTrain 使用 [TransLink GTFS Static Data](https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources/gtfs/gtfs-data)，来源、运营日期、完整性检查和 SHA-256 见 `data/audit/skytrain.json`。

Route and arrival data used in this product or service is provided by permission of TransLink. TransLink assumes no responsibility for the accuracy or currency of the Data used in this product or service.
