# 规则重算记录（未调用模型）

- 执行时间：2026/9/18 17:59:54
- 规则版本：r3.0.0
- 模型输出来源：提示词 v3.0.0（本脚本未重新调用模型）

## 校验问题

- 重算前：12 条 {"evidence_missing":1,"evidence_not_located":3,"condition_unconfirmed":6,"title_unverified":2}
- 重算后：10 条 {"evidence_missing":1,"evidence_not_located":3,"condition_unconfirmed":6}

## 关系可信度

- 状态发生变化的条数：0

- Deep Residual Learning for → A ConvNet for the 2020s：保持 candidate｜引文提到了被继承方法「ResNet」。缺少继承/组合措辞或引用标记。
- Swin Transformer: Hierarch → A ConvNet for the 2020s：保持 candidate｜引文提到了被继承方法「Swin Transformer」；提到了关系另一端「ConvNeXt」。缺少继承/组合措辞或引用标记。

## 分歧发现

- 种类发生变化的条数：0


## 说明

本文件中的变化全部由程序按新规则重算得到，不包含任何新的模型输出。
需要模型重新判断的部分（字段值、实验条件的取值范围、推荐文字）保持原样，并在界面标记为旧提示词产物。