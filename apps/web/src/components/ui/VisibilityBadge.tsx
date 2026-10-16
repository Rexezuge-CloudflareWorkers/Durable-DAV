import { useTranslation } from 'react-i18next';
import { Badge } from '@rexezuge/web';

/**
 * This app's visibility vocabulary on the kit's tone layer.
 *
 * The kit's `Badge` is a *tone* (`success`/`warning`/…) and its own docs say the
 * domain badges — `ConnectionBadge`, `VisibilityBadge`, … — stay with their apps,
 * because the label is a product translation key. This is that mapping; it used
 * to sit one component above a re-spelled copy of the kit's badge classes.
 */
export function VisibilityBadge({ isPrivate }: { isPrivate: boolean }) {
  const { t } = useTranslation();
  return (
    <Badge variant={isPrivate ? 'warning' : 'success'}>{isPrivate ? t('volumes.private', 'Private') : t('volumes.public', 'Public')}</Badge>
  );
}
