/**
 * 面经题目表单（添加/编辑统一五字段：问题、我的回答、理想回答、回答好坏、知识点）。
 * - create 模式：先选投递 → 再选该投递下已有面试轮次（无轮次则引导去投递详情添加）
 * - edit 模式：字段预填，投递/轮次不可改
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/ipc";
import type { InterviewQuestion } from "@shared";
import { QUESTION_QUALITY_LABELS, type QuestionQuality } from "@shared";
import { Button, Field, Modal, Select, TextInput } from "@/components/ui";

interface Props {
  open: boolean;
  onClose: () => void;
  /** edit 模式的题目 */
  editQuestion?: InterviewQuestion | null;
  /** create 模式固定轮次（从面试记录页进入时传入） */
  fixedInterviewId?: string | null;
  /** create 模式固定轮次的展示名 */
  fixedInterviewLabel?: string;
}

export function QuestionModal({
  open,
  onClose,
  editQuestion,
  fixedInterviewId,
  fixedInterviewLabel,
}: Props) {
  const queryClient = useQueryClient();
  const isEdit = !!editQuestion;

  const [appId, setAppId] = useState("");
  const [interviewId, setInterviewId] = useState("");
  const [question, setQuestion] = useState("");
  const [myAnswer, setMyAnswer] = useState("");
  const [idealAnswer, setIdealAnswer] = useState("");
  const [quality, setQuality] = useState<QuestionQuality>("UNKNOWN");
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");

  const { data: apps } = useQuery({
    queryKey: ["applications", ""],
    queryFn: () => api.listApplications({}),
    enabled: open && !isEdit && !fixedInterviewId,
  });

  // 编辑预填 / create 打开时重置
  useEffect(() => {
    if (!open) return;
    setError("");
    if (editQuestion) {
      setQuestion(editQuestion.question);
      setMyAnswer(editQuestion.myAnswer ?? "");
      setIdealAnswer(editQuestion.reflection ?? "");
      setQuality(editQuestion.quality);
      setTags(editQuestion.tags.join(", "));
    } else {
      setQuestion("");
      setMyAnswer("");
      setIdealAnswer("");
      setQuality("UNKNOWN");
      setTags("");
      setInterviewId(fixedInterviewId ?? "");
    }
  }, [open, editQuestion, fixedInterviewId]);

  // create 模式：选中投递后拉取轮次
  const { data: detail } = useQuery({
    queryKey: ["application-detail", appId],
    queryFn: () => api.getApplicationDetail(appId),
    enabled: open && !isEdit && !fixedInterviewId && !!appId,
  });
  const rounds = detail?.interviews ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["applications"] });
    queryClient.invalidateQueries({ queryKey: ["application-detail"] });
    queryClient.invalidateQueries({ queryKey: ["question-bank"] });
  };

  const save = useMutation({
    mutationFn: () =>
      isEdit
        ? api.updateQuestion(editQuestion!.id, {
            question: question.trim(),
            myAnswer: myAnswer.trim() || null,
            reflection: idealAnswer.trim() || null,
            quality,
            tags: tags.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean),
          })
        : api.addQuestion({
            interviewId: fixedInterviewId ?? interviewId,
            question: question.trim(),
            myAnswer: myAnswer.trim() || null,
            reflection: idealAnswer.trim() || null,
            quality,
            tags: tags.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean),
          }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (e) => setError(String(e)),
  });

  const noRounds = !isEdit && !fixedInterviewId && !!appId && rounds.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "编辑面经" : fixedInterviewLabel ? `记一道题 · ${fixedInterviewLabel}` : "添加面经"}
      wide
    >
      <div className="space-y-4">
        {!isEdit && !fixedInterviewId && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="投递岗位 *">
              <Select
                value={appId}
                onChange={(e) => {
                  setAppId(e.target.value);
                  setInterviewId("");
                }}
              >
                <option value="">选择投递…</option>
                {(apps ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.companyName}
                    {a.department ? ` · ${a.department}` : ""} · {a.positionTitle}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="面试轮次 *"
              hint={noRounds ? "该投递还没有面试轮次，请先到投递详情添加（面经依附于轮次）" : undefined}
            >
              <Select
                value={interviewId}
                onChange={(e) => setInterviewId(e.target.value)}
                disabled={!appId || noRounds}
              >
                <option value="">{appId ? (noRounds ? "（无轮次）" : "选择轮次…") : "先选投递"}</option>
                {rounds.map((iv) => (
                  <option key={iv.id} value={iv.id}>
                    第 {iv.round} 轮{iv.roundLabel ? `（${iv.roundLabel}）` : ""}
                    {iv.status === "SCHEDULED" ? " · 已约" : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        {isEdit && fixedInterviewLabel && (
          <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800">
            {fixedInterviewLabel}
          </div>
        )}

        <Field label="问题 *">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={2}
            placeholder="被问到什么？"
            className="w-full rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </Field>
        <Field label="我的回答">
          <textarea
            value={myAnswer}
            onChange={(e) => setMyAnswer(e.target.value)}
            rows={3}
            placeholder="当时怎么答的（摘要）"
            className="w-full rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </Field>
        <Field label="理想回答">
          <textarea
            value={idealAnswer}
            onChange={(e) => setIdealAnswer(e.target.value)}
            rows={3}
            placeholder="更优答案 / 应该怎么答"
            className="w-full rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </Field>
        <div className="grid grid-cols-[140px_1fr] gap-4">
          <Field label="回答的好坏">
            <Select value={quality} onChange={(e) => setQuality(e.target.value as QuestionQuality)}>
              {Object.entries(QUESTION_QUALITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="知识点（逗号分隔）">
            <TextInput
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="如：操作系统, LRU, Agent"
            />
          </Field>
        </div>

        {error && <div className="text-sm text-red-500">{error}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            disabled={save.isPending || !question.trim() || (!isEdit && !fixedInterviewId && !interviewId)}
            onClick={() => {
              setError("");
              if (!question.trim()) return setError("问题不能为空");
              save.mutate();
            }}
          >
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? "保存" : "添加"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
