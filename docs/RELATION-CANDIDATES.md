# 真实论文中的关系证据候选（确定性检索，未调用模型）

- 生成时间：2026/9/17 15:42:42
- 方法：在论文全文中按「句子含关系措辞」且「句子含被继承方法的方法名（含别名）」检索，展示完整句子与页码。
- 用途：人工判断是否存在足以认证具体关系的句子；这些句子**不等于**已认证的原文明示。

## BERT: Pre-training of Deep Bidirectional Trans → RoBERTa: A Robustly Optimized BERT Pretraining

- 被继承方法名（抽取值）：BERT (Bidirectional Encoder Representations from Transformers)
- 检索用别名：BERT

### 候选句子（共 13 条；含方法名 + 关系措辞）

- **【RoBERTa: A Robustly Optimized  · p.1】** 命中措辞：`improves`
  > When controlling for training data, our im- proved training procedure improves upon the pub- lished BERT results on both GLUE and SQuAD.
- **【RoBERTa: A Robustly Optimized  · p.1】** 命中措辞：`improve`
  > 2 In summary, the contributions of this paper are: (1) We present a set of important BERT de- sign choices and training strategies and introduce 2 It is possible that these other methods could also improve with more tuning.
- **【RoBERTa: A Robustly Optimized  · p.3】** 命中措辞：`follows the`
  > Our finetuning procedure follows the original BERT paper (Devlin et al.
- **【RoBERTa: A Robustly Optimized  · p.4】** 命中措辞：`we adopt`
  > 1 we adopt the same span pre- diction method as BERT (Devlin et al.
- **【RoBERTa: A Robustly Optimized  · p.4】** 命中措辞：`follows the`
  > To better understand this discrepancy, we com- pare several alternative training formats: • SEGMENT-PAIR+NSP: This follows the original input format used in BERT (Devlin et al.
- **【RoBERTa: A Robustly Optimized  · p.6】** 命中措辞：`improve`
  > 5 RoBERTa In the previous section we propose modifications to the BERT pretraining procedure that improve end-task performance.
- **【RoBERTa: A Robustly Optimized  · p.8】** 命中措辞：`based on`
  > Following recent work, we adopt the ranking approach for our test submission, but for direct comparison with BERT we report development set results based on a pure classification approach.
- **【RoBERTa: A Robustly Optimized  · p.9】** 命中措辞：`build upon`
  > Most of the top systems build upon either BERT (Devlin et al.
- **【BERT: Pre-training of Deep Bid · p.1】** 命中措辞：`improve`
  > In this paper, we improve the fine-tuning based approaches by proposing BERT: Bidirectional Encoder Representations from Transformers.
- **【BERT: Pre-training of Deep Bid · p.3】** 命中措辞：`based on`
  > Model Architecture BERT’s model architec- ture is a multi-layer bidirectional Transformer en- coder based on the original implementation de- scribed in Vaswani et al.
- **【BERT: Pre-training of Deep Bid · p.6】** 命中措辞：`outperform`
  > In fact, our single BERT model outperforms the top ensemble sys- tem in terms of F1 score.
- **【BERT: Pre-training of Deep Bid · p.9】** 命中措辞：`we use`
  > In the input to BERT, we use a case-preserving WordPiece model, and we include the maximal document context provided by the data.

### 与现有流水线候选片段的关系

- 现有流水线送入模型的片段：4 个窗口（每篇论文在被继承方法名附近取 2 段，前后各 420 字符）。
- 上述候选句子中，落在这些窗口内的：**13 / 13**。

## BERT: Pre-training of Deep Bidirectional Trans → DistilBERT, a distilled version of BERT: small

- 被继承方法名（抽取值）：BERT (Bidirectional Encoder Representations from Transformers)
- 检索用别名：BERT

### 候选句子（共 13 条；含方法名 + 关系措辞）

- **【DistilBERT, a distilled versio · p.1】** 命中措辞：`distill`
  > DistilBERT, a distilled version of BERT: smaller, faster, cheaper and lighter Victor SANH, Lysandre DEBUT, Julien CHAUMOND, Thomas WOLF Hugging Face {victor,lysandre,julien,thomas}@huggingface.
- **【DistilBERT, a distilled versio · p.1】** 命中措辞：`distill`
  > While most prior work investigated the use of distillation for building task-specific models, we leverage knowledge distillation during the pre-training phase and show that it is possible to reduce the size of a BERT model by 40%, while retaining 97% of its language understanding capabilities and being 60% faster.
- **【DistilBERT, a distilled versio · p.2】** 命中措辞：`distill`
  > 3 DistilBERT: a distilled version of BERT Student architecture In the present work, the student - DistilBERT - has the same general architec- ture as BERT.
- **【DistilBERT, a distilled versio · p.3】** 命中措辞：`Distill`
  > time (Millions) (seconds) ELMo 180 895 BERT-base 110 668 DistilBERT 66 410 Distillation We applied best practices for training BERT model recently proposed in Liu et al.
- **【DistilBERT, a distilled versio · p.3】** 命中措辞：`distill`
  > We also studied whether we could add another step of distillation during the adaptation phase by fine-tuning DistilBERT on SQuAD using a BERT model previously fine-tuned on SQuAD as a 4 We use jiant [Wang et al.
- **【DistilBERT, a distilled versio · p.4】** 命中措辞：`based on`
  > We compare the average inference time on a recent smartphone (iPhone 7 Plus) against our previously trained question answering model based on BERT-base.
- **【DistilBERT, a distilled versio · p.4】** 命中措辞：`distill`
  > Chatterjee [2019] distill BERT model fine-tuned on SQuAD in a smaller Transformer model previ- ously initialized from BERT.
- **【DistilBERT, a distilled versio · p.5】** 命中措辞：`Distill`
  > Distilling task-specific knowledge from bert into simple neural networks.
- **【BERT: Pre-training of Deep Bid · p.1】** 命中措辞：`improve`
  > In this paper, we improve the fine-tuning based approaches by proposing BERT: Bidirectional Encoder Representations from Transformers.
- **【BERT: Pre-training of Deep Bid · p.3】** 命中措辞：`based on`
  > Model Architecture BERT’s model architec- ture is a multi-layer bidirectional Transformer en- coder based on the original implementation de- scribed in Vaswani et al.
- **【BERT: Pre-training of Deep Bid · p.6】** 命中措辞：`outperform`
  > In fact, our single BERT model outperforms the top ensemble sys- tem in terms of F1 score.
- **【BERT: Pre-training of Deep Bid · p.9】** 命中措辞：`we use`
  > In the input to BERT, we use a case-preserving WordPiece model, and we include the maximal document context provided by the data.

### 与现有流水线候选片段的关系

- 现有流水线送入模型的片段：4 个窗口（每篇论文在被继承方法名附近取 2 段，前后各 420 字符）。
- 上述候选句子中，落在这些窗口内的：**10 / 13**。
- 说明：**有候选句子没有被送入模型**，属于候选片段检索问题，应改进检索（不是放宽认证标准）。

## Attention Is All You Need → BERT: Pre-training of Deep Bidirectional Trans

- 被继承方法名（抽取值）：Transformer
- 检索用别名：Transformer

### 候选句子（共 7 条；含方法名 + 关系措辞）

- **【BERT: Pre-training of Deep Bid · p.2】** 命中措辞：`Unlike`
  > Unlike left-to- right language model pre-training, the MLM ob- jective enables the representation to fuse the left and the right context, which allows us to pre- train a deep bidirectional Transformer.
- **【BERT: Pre-training of Deep Bid · p.3】** 命中措辞：`based on`
  > Model Architecture BERT’s model architec- ture is a multi-layer bidirectional Transformer en- coder based on the original implementation de- scribed in Vaswani et al.
- **【Attention Is All You Need · p.8】** 命中措辞：`outperform`
  > 1 Machine Translation On the WMT 2014 English-to-German translation task, the big transformer model (Transformer (big) in Table 2) outperforms the best previously reported models (including ensembles) by more than 2.
- **【Attention Is All You Need · p.8】** 命中措辞：`We use`
  > 2 Model Variations To evaluate the importance of different components of the Transformer, we varied our base model in different ways, measuring the change in performance on English-to-German translation on the 5 We used values of 2.
- **【Attention Is All You Need · p.10】** 命中措辞：`outperform`
  > In contrast to RNN sequence-to-sequence models [37], the Transformer outperforms the Berkeley- Parser [29] even when training only on the WSJ training set of 40K sentences.
- **【Attention Is All You Need · p.10】** 命中措辞：`based on`
  > For translation tasks, the Transformer can be trained significantly faster than architectures based on recurrent or convolutional layers.
- **【Attention Is All You Need · p.10】** 命中措辞：`extend`
  > We plan to extend the Transformer to problems involving input and output modalities other than text and to investigate local, restricted attention mechanisms to efficiently handle large inputs and outputs such as images, audio and video.

### 与现有流水线候选片段的关系

- 现有流水线送入模型的片段：4 个窗口（每篇论文在被继承方法名附近取 2 段，前后各 420 字符）。
- 上述候选句子中，落在这些窗口内的：**2 / 7**。
- 说明：**有候选句子没有被送入模型**，属于候选片段检索问题，应改进检索（不是放宽认证标准）。

## BERT: Pre-training of Deep Bidirectional Trans → Language Models are Few-Shot Learners

- 被继承方法名（抽取值）：BERT (Bidirectional Encoder Representations from Transformers)
- 检索用别名：BERT

### 候选句子（共 11 条；含方法名 + 关系措辞）

- **【Language Models are Few-Shot L · p.13】** 命中措辞：`improves`
  > 1% lower than the fine-tuned SOTA using a BERT based model [ LDL19 ] but improves over previous zero-shot results by roughly 10%.
- **【Language Models are Few-Shot L · p.18】** 命中措辞：`outperform`
  > On DROP [DWD + 19 ], a dataset testing discrete reasoning and numeracy in the context of reading comprehension, GPT-3 in a few-shot setting outperforms the fine-tuned BERT baseline from the original paper but is still well below both human performance and state-of-the-art approaches which augment neural networks with symbolic systems [RLL + 19 ].
- **【Language Models are Few-Shot L · p.20】** 命中措辞：`outperform`
  > Despite these weaknesses, GPT-3 still outperforms a fine-tuned BERT-large on four of eight tasks and on two tasks GPT-3 is close to the state-of-the-art held by a fine-tuned 11 billion parameter model.
- **【Language Models are Few-Shot L · p.20】** 命中措辞：`outperform`
  > When sweeping over values of K, we find that GPT-3 requires less than eight total examples per task to outperform a fine-tuned BERT-Large on overall SuperGLUE score.
- **【Language Models are Few-Shot L · p.70】** 命中措辞：`Distill`
  > TinyBERT: Distilling BERT for natural language understanding.
- **【Language Models are Few-Shot L · p.73】** 命中措辞：`distill`
  > DistilBERT, a distilled version of BERT: smaller, faster, cheaper and lighter.
- **【BERT: Pre-training of Deep Bid · p.1】** 命中措辞：`improve`
  > In this paper, we improve the fine-tuning based approaches by proposing BERT: Bidirectional Encoder Representations from Transformers.
- **【BERT: Pre-training of Deep Bid · p.3】** 命中措辞：`based on`
  > Model Architecture BERT’s model architec- ture is a multi-layer bidirectional Transformer en- coder based on the original implementation de- scribed in Vaswani et al.
- **【BERT: Pre-training of Deep Bid · p.6】** 命中措辞：`outperform`
  > In fact, our single BERT model outperforms the top ensemble sys- tem in terms of F1 score.
- **【BERT: Pre-training of Deep Bid · p.9】** 命中措辞：`we use`
  > In the input to BERT, we use a case-preserving WordPiece model, and we include the maximal document context provided by the data.
- **【BERT: Pre-training of Deep Bid · p.14】** 命中措辞：`improve`
  > 1 account for the majority of the empirical improvements, but we do note that there are several other differences between how BERT and GPT were trained: • GPT is trained on the BooksCorpus (800M words); BERT is trained on the BooksCor- pus (800M words) and Wikipedia (2,500M words).

### 与现有流水线候选片段的关系

- 现有流水线送入模型的片段：4 个窗口（每篇论文在被继承方法名附近取 2 段，前后各 420 字符）。
- 上述候选句子中，落在这些窗口内的：**9 / 11**。
- 说明：**有候选句子没有被送入模型**，属于候选片段检索问题，应改进检索（不是放宽认证标准）。

---

## 判定边界（重要）

- 本文件的候选句子只说明「原文里有这样的句子」，**不代表**该关系已被认证为原文明示。
- 认证仍要求：句子必须指名被继承方法，并具备对应关系类型的措辞；仅有关键词或引用标记不足以认证。
- 关系类型（继承/改进/组合/相似）必须与句子表达的语义一致，程序不作语义推断。