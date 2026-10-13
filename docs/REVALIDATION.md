# 规则重算记录（未调用模型）

- 执行时间：2026/10/13 12:20:02
- 规则版本：r3.4.0
- 模型输出来源：提示词 v3.0.0（本脚本未重新调用模型）

## 校验问题

- 重算前：7 条 {"title_unverified":2,"condition_unconfirmed":3,"evidence_not_located":2}
- 重算后：5 条 {"condition_unconfirmed":3,"evidence_not_located":2}

## 关系可信度

- 状态发生变化的条数：0

- Training data-efficient im → A ConvNet for the 2020s：保持 inferred｜引文提到了被继承方法「DeiT」；含引用标记「[73]」。缺少能支撑「相似/相关」的措辞（如 similar to / comparable to / most related / in contrast to）。注意「拿它当基线」「against」「compared with」只是实验设置，不构成关系主张。
- Swin Transformer: Hierarch → A ConvNet for the 2020s：保持 explicit｜引文提到了被继承方法「Swin Transformer」；提到了关系另一端「ConvNeXt」；含改进措辞「outperform」，足以支撑「improves」关系。
- Training data-efficient im → Swin Transformer: Hierarch：保持 candidate｜引文提到了被继承方法「DeiT」；含改进措辞「outperforms」；含引用标记「[20, 63]」。句子没有指向关系另一端（既未提到对方方法名，也不是本论文的自指表述）。

## 分歧发现

- 种类发生变化的条数：0


## 说明

本文件中的变化全部由程序按新规则重算得到，不包含任何新的模型输出。
需要模型重新判断的部分（字段值、实验条件的取值范围、推荐文字）保持原样，并在界面标记为旧提示词产物。