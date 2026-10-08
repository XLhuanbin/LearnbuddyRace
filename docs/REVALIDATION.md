# 规则重算记录（未调用模型）

- 执行时间：2026/10/8 15:15:45
- 规则版本：r3.1.0
- 模型输出来源：提示词 v3.0.0（本脚本未重新调用模型）

## 校验问题

- 重算前：18 条 {"page_mismatch":2,"evidence_missing":3,"condition_not_extracted":3,"evidence_not_located":8,"condition_unconfirmed":2}
- 重算后：18 条 {"page_mismatch":2,"evidence_missing":3,"condition_not_extracted":3,"evidence_not_located":8,"condition_unconfirmed":2}

## 关系可信度

- 状态发生变化的条数：0

- Attention Is All You Need → BERT: Pre-training of Deep：保持 explicit｜引文提到了被继承方法「Transformer」；提到了关系另一端「BERT」；含继承/组合措辞「based on」，足以支撑「extends」关系。
- BERT: Pre-training of Deep → RoBERTa: A Robustly Optimi：保持 explicit｜引文提到了被继承方法「BERT」；含改进措辞「improves」，足以支撑「improves」关系。
- BERT: Pre-training of Deep → DistilBERT, a distilled ve：保持 explicit｜引文提到了被继承方法「BERT」；提到了关系另一端「DistilBERT」；含继承/组合措辞「distilled version of」，足以支撑「extends」关系。
- Attention Is All You Need → DistilBERT, a distilled ve：保持 inferred｜引文提到了被继承方法「Transformer」；含引用标记「[2017]」，足以支撑「extends」关系。

## 分歧发现

- 种类发生变化的条数：0


## 说明

本文件中的变化全部由程序按新规则重算得到，不包含任何新的模型输出。
需要模型重新判断的部分（字段值、实验条件的取值范围、推荐文字）保持原样，并在界面标记为旧提示词产物。