import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ExternalLink, ShieldCheck } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { openUrl } from '@/platform'
import type { ForgeDetail, ModSummary } from '@/wails/contract'
import { registryText } from '../i18n/registry-text'
import {
  AddonBadge,
  FikaBadge,
  ModBadge,
  ParentLinkBadge,
  ParentStatusBadge,
  StandaloneBadge,
} from './registry-item-badges'
import { RegistryThumbnail } from './registry-thumbnail'
import type { ParentConstraintStatus } from '../data/registry-repository'

export function RegistryDetailContent({
  detail,
  parentStatus,
  hasParentBlock,
  matchableMods,
  selectedLocalModId,
  isLibraryBusy,
  isRateLimited,
  onSelectLocalMod,
  onSelectParent,
  onOpenParentHelp,
}: {
  detail: ForgeDetail
  parentStatus: ParentConstraintStatus
  hasParentBlock: boolean
  matchableMods: ModSummary[]
  selectedLocalModId: string
  isLibraryBusy: boolean
  isRateLimited: boolean
  onSelectLocalMod: (id: string) => void
  onSelectParent: (parent: ForgeDetail['parent']) => void
  onOpenParentHelp?: (item: ForgeDetail) => void
}) {
  return (
    <>
      <div className="flex items-start gap-3.5">
        <RegistryThumbnail
          name={detail.name}
          thumbnail={detail.thumbnail}
          kind={detail.kind}
          size="icons"
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold leading-tight text-foreground">
            {detail.name}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {detail.kind === 'mod' ? (
              <ModBadge />
            ) : detail.isDetached ? (
              <StandaloneBadge />
            ) : (
              <AddonBadge />
            )}
            {detail.fikaCompatibility && <FikaBadge />}
          </div>
          {detail.detailUrl && (
            <button
              type="button"
              onClick={() =>
                void openUrl(detail.detailUrl ?? '').catch(() => {
                  window.open(
                    detail.detailUrl ?? '',
                    '_blank',
                    'noopener,noreferrer',
                  )
                })
              }
              className="mt-2.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <span>{registryText.actionViewOnForge()}</span>
              <ExternalLink className="size-3" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {detail.kind === 'addon' && !detail.isDetached && (
        <div className="rounded-md border border-[color-mix(in_srgb,var(--primary)_24%,transparent)] bg-[color-mix(in_srgb,var(--primary)_8%,transparent)] p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[var(--primary)]">
              {registryText.parentModRequirements()}
            </span>
            <ParentStatusBadge status={parentStatus} />
          </div>
          <div className="mt-2 text-muted-foreground">
            <p>
              {registryText.detailParentRequirement(
                detail.parent?.name ?? 'Parent Mod',
                detail.modVersionConstraint ?? '*',
              )}
            </p>
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <ParentLinkBadge
              parentName={detail.parent?.name ?? 'Parent Mod'}
              onClick={() => onSelectParent(detail.parent)}
            />
            {hasParentBlock && onOpenParentHelp && (
              <button
                type="button"
                onClick={() => onOpenParentHelp(detail)}
                className="text-xs text-[var(--muted-foreground)] hover:underline"
              >
                {registryText.detailResolveDependency()}
              </button>
            )}
          </div>
        </div>
      )}

      <section className="space-y-2 rounded-md border border-border bg-background/30 p-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {registryText.matchSectionHeader()}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {registryText.matchSectionDescription()}
          </p>
        </div>
        {matchableMods.length > 0 ? (
          <div className="space-y-1.5">
            <label
              className="text-xs font-medium text-foreground"
              htmlFor="registry-local-mod-match"
            >
              {registryText.matchExistingInstallLabel()}
            </label>
            <Select
              value={selectedLocalModId}
              onValueChange={onSelectLocalMod}
              disabled={isLibraryBusy || isRateLimited}
            >
              <SelectTrigger
                id="registry-local-mod-match"
                className="h-8 text-xs"
              >
                <SelectValue
                  placeholder={registryText.matchSelectPlaceholder()}
                />
              </SelectTrigger>
              <SelectContent>
                {matchableMods.map((mod) => (
                  <SelectItem key={mod.id} value={mod.id}>
                    {mod.name}
                    {mod.version ? ` — v${mod.version}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {registryText.matchNoLocalMods()}
          </p>
        )}
      </section>

      <div className="flex items-start gap-2 rounded-md border border-border bg-background/50 p-2.5 text-xs text-muted-foreground">
        <ShieldCheck
          className="mt-0.5 size-4 shrink-0 text-[var(--primary)]"
          aria-hidden
        />
        <span>{registryText.archiveSafetyNote()}</span>
      </div>

      {detail.description && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {registryText.detailDescription()}
          </h3>
          <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border border-border bg-background/30 p-3 text-xs leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {detail.description}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </>
  )
}
