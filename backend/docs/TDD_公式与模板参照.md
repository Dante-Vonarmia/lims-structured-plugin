# TDD 公式与模板参照

更新时间：2026-03-29

## 目标
- 把“模板配置 + 公式层”的行为固化为可执行参照。
- 测试既是验收基线，也是团队文档。

## 测试文件
- `backend/tests/test_field_dictionary_tdd.py`
- `backend/tests/test_template_schema_tdd.py`

## 运行方式
```bash
python3 -m unittest discover -s backend/tests -p "*_tdd.py" -v
```

## 覆盖点
- `linearity_metrics`：自动计算 `Fi / F / 相对变化量`
- `list_subtract + list_mean`：屏蔽效能 `SE = P1 - P2` 及平均值
- `list_mean + list_stddev`：击穿电压均值与标准偏差
- 模板字段自动推断：
  - 高电压测量系统（R-859B 类）
  - 局放（036/037 类）
  - 屏蔽室（882B 类）

## 模板试验样本（第1个）
- 模板：`R-872B 线材扭转试验机`（业务称呼：金属线材扭转试验仪）
- profile：`backend/app/rules/template_profiles/r-872b.yaml`
- TDD：`backend/tests/test_template_r872b_tdd.py`
- 验收点：
  - profile 已包含业务别名（如“金属线材扭转试验仪”）
  - profile 已包含证书模板别名（如“1 金属扭转CNAS.docx”）
  - 字段清单包含 `measurement_items`

## 约束说明
- 目前优先验证“字段与公式管线”本身，不依赖 Web/API 层。
- Web 端和文档位点渲染可在下一批补集成测试。
