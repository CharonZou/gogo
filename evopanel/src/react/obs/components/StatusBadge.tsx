import type { Status } from '../types';
import { useT } from '../../lib/useI18n'

export function StatusBadge({ status }: { status: Status }) {
  const t = useT() // 局部遮蔽
  // 状态→中文 label 渲染期组装，以便切换语言时更新
  const labelMap: Record<string, string> = {
    success: t('obs.obsStatusSuccess'),
    warning: t('obs.obsStatusWarning'),
    failed: t('obs.obsStatusFailed'),
    normal: t('obs.obsStatusNormal'),
    error: t('obs.obsStatusError'),
  };
  return <span className={`status-badge status-${status}`}>{labelMap[status] ?? status}</span>;
}
