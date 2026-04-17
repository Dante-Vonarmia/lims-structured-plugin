from typing import Any


def build_field_registry() -> dict[str, dict[str, Any]]:
    return {
        "certificate_no": {"label": "序号"},
        "device_name": {"label": "气瓶名称"},
        "manufacturer": {"label": "制造厂/商"},
        "device_model": {"label": "型号/规格"},
        "device_code": {"label": "气瓶编号"},
        "basis_mode": {"label": "依据类型（检测/校准）"},
        "basis_standard": {"label": "检测/校准依据", "wide": True},
        "temperature": {"label": "温度 (℃)"},
        "humidity": {"label": "湿度 (%RH)"},
        "location": {"label": "检测/校准地点", "wide": True},
        "measurement_items": {"label": "检测项目", "wide": True},
        "general_check_full": {"label": "校准结果/说明（续页）", "wide": True},
        "urel_percent": {"label": "扩展不确定度 Urel (%)"},
        "voltage_range_1": {"label": "量程1 (kV)"},
        "voltage_indicated_values_1": {"label": "量程1 指示值(kV)", "wide": True},
        "voltage_actual_values_1": {"label": "量程1 实际值(kV)", "wide": True},
        "voltage_range_2": {"label": "量程2 (kV)"},
        "voltage_indicated_values_2": {"label": "量程2 指示值(kV)", "wide": True},
        "voltage_actual_values_2": {"label": "量程2 实际值(kV)", "wide": True},
        "voltage_range_3": {"label": "量程3 (kV)"},
        "voltage_indicated_values_3": {"label": "量程3 指示值(kV)", "wide": True},
        "voltage_actual_values_3": {"label": "量程3 实际值(kV)", "wide": True},
        "linearity_ux_values": {"label": "被校系统工频高压示值 Ux(kV)", "wide": True},
        "linearity_u2_values": {"label": "变压器空载输出电压示值 U2(V)", "wide": True},
        "linearity_fi_values": {"label": "Ux 和 U2 比值 Fi", "wide": True},
        "linearity_f_avg": {"label": "Fi 平均值 F"},
        "linearity_fi_delta_percent": {"label": "Fi 与 F 的相对变化量(%)", "wide": True},
        "pd_charge_values_pc": {"label": "局放电荷量序列 (pC)", "wide": True},
        "pd_charge_avg_pc": {"label": "局放电荷量平均值 (pC)"},
        "pd_rise_time_values_ns": {"label": "局放上升沿时间序列 (ns)", "wide": True},
        "pd_rise_time_avg_ns": {"label": "局放上升沿时间平均值 (ns)"},
        "pd_pulse_amplitude_values_v": {"label": "局放脉冲幅值序列 (V)", "wide": True},
        "pd_pulse_amplitude_avg_v": {"label": "局放脉冲幅值平均值 (V)"},
        "pd_voltage_urel_percent": {"label": "局放电压 Urel (%)"},
        "pd_scan_time_urel_percent": {"label": "局放扫描时间 Urel (%)"},
        "pd_capacitance_urel_percent": {"label": "局放电容 Urel (%)"},
        "pd_power_tolerance_urel_percent": {"label": "局放试验电源容差 Urel (%)"},
        "pd_voltage_calibration_urel_percent": {"label": "局放试验电压校准 Urel (%)"},
        "shield_background_noise_0kv_pc": {"label": "屏蔽室0kV背景噪声 (pC)"},
        "shield_background_noise_working_kv_pc": {"label": "屏蔽室工作电压背景噪声 (pC)"},
        "shield_p1_dbm_values": {"label": "无屏蔽室功率 P1(dBm)", "wide": True},
        "shield_p2_dbm_values": {"label": "屏蔽室内功率 P2(dBm)", "wide": True},
        "shield_se_db_values": {"label": "屏蔽效能序列 SE(dB)", "wide": True},
        "shield_se_avg_db": {"label": "屏蔽效能平均值 SE(dB)"},
        "breakdown_voltage_values_kv": {"label": "击穿电压序列 (kV)", "wide": True},
        "breakdown_voltage_avg_kv": {"label": "击穿电压平均值 (kV)"},
        "breakdown_voltage_stddev_kv": {"label": "击穿电压标准偏差 (kV)"},
    }


def to_editor_fields(keys: list[str]) -> list[dict[str, Any]]:
    registry = build_field_registry()
    result: list[dict[str, Any]] = []
    for key in keys:
        spec = registry.get(key)
        if not spec:
            continue
        row = {
            "key": key,
            "label": spec["label"],
            "wide": bool(spec.get("wide", False)),
        }
        result.append(row)
    return result
