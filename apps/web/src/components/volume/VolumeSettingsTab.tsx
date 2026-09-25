import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VolumeDetail } from '../../types';
import { toLocalizedErrorMessage } from '../../lib/backendErrors';
import { loadVolume, updateVolume, deleteVolume } from '../../services/volumeService';
import { Button } from '../ui/Button';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Label, Textarea } from '../ui/Input';
import { RefreshButton } from '../shared/RefreshButton';
import { ConfirmDeleteModal } from '../modals/ConfirmDeleteModal';
import { VolumeCredentialsCard } from './VolumeCredentialsCard';

export function VolumeSettingsTab({
  owner,
  volume,
  showNotice,
  onUpdated,
  onDeleted,
}: {
  owner: string;
  volume: string;
  showNotice: (type: 'success' | 'error', text: string) => void;
  onUpdated: (detail: VolumeDetail) => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<VolumeDetail | null>(null);
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const loaded = await loadVolume(owner, volume);
        if (cancelled) return;
        setDetail(loaded);
        setDescription(loaded.description ?? '');
        setIsPrivate(loaded.isPrivate);
        onUpdated(loaded);
      } catch (error) {
        if (cancelled) return;
        showNotice('error', toLocalizedErrorMessage(t, error, 'errors.failedToLoadVolumes', 'Failed To Load Volumes.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [owner, volume, showNotice, t, onUpdated]);

  const dirty =
    detail !== null && (description.trim() !== (detail.description ?? '') || isPrivate !== detail.isPrivate);

  const reset = () => {
    if (!detail) return;
    setDescription(detail.description ?? '');
    setIsPrivate(detail.isPrivate);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await updateVolume(owner, volume, {
        description: description.trim() === '' ? null : description.trim(),
        isPrivate,
      });
      setDetail(updated);
      onUpdated(updated);
      showNotice('success', t('volumes.settingsUpdated', 'Bucket Settings Updated.'));
    } catch (error) {
      showNotice('error', toLocalizedErrorMessage(t, error, 'errors.failedToUpdateVolume', 'Failed To Update Bucket.'));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await deleteVolume(owner, volume);
      showNotice('success', t('volumes.volumeDeleted', 'Bucket Deleted.'));
      onDeleted();
    } catch (error) {
      showNotice('error', toLocalizedErrorMessage(t, error, 'errors.failedToDeleteVolume', 'Failed To Delete Bucket.'));
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('volumes.general', 'General')}</CardTitle>
          <RefreshButton onRefresh={reset} loading={saving || loading} />
        </CardHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="volume-settings-description">{t('volumes.description', 'Description')}</Label>
            <Textarea
              id="volume-settings-description"
              placeholder={t('volumes.descriptionPlaceholder', 'A Short Description Of This Bucket')}
              value={description}
              maxLength={500}
              rows={3}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2.5 text-sm text-[var(--color-text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            {t('volumes.privateVolume', 'Private Volume')}
          </label>
          <p className="text-xs text-[var(--color-text-muted)]">
            {t(
              'volumes.visibilityHint',
              'Private Buckets Need A Bucket Credential For Every Request. Public Buckets Allow Anonymous Reads.',
            )}
          </p>
          <div>
            <Button type="submit" variant="primary" size="sm" loading={saving} disabled={!dirty}>
              {t('common.saveChanges', 'Save Changes')}
            </Button>
          </div>
        </form>
      </Card>

      <VolumeCredentialsCard owner={owner} volume={volume} showNotice={showNotice} />

      <Card className="border-[var(--color-error-text)]/40">
        <CardHeader>
          <CardTitle>{t('volumes.dangerZone', 'Danger Zone')}</CardTitle>
        </CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-medium text-[var(--color-text-primary)]">
              {t('volumes.deleteThisBucket', 'Delete This Bucket')}
            </p>
            <p className="text-sm text-[var(--color-text-secondary)]">
              {t(
                'volumes.deleteBucketDescription',
                'Permanently Deletes The Bucket, Its Files, And Its Credentials. This Cannot Be Undone.',
              )}
            </p>
          </div>
          <Button variant="danger" size="sm" loading={deleting} onClick={() => setConfirmingDelete(true)}>
            {t('volumes.deleteBucket', 'Delete Bucket')}
          </Button>
        </div>
      </Card>

      {confirmingDelete && (
        <ConfirmDeleteModal
          title={t('volumes.deleteBucket', 'Delete Bucket')}
          displayName={`${owner}/${volume}`}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
