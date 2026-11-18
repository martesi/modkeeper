import type { ForgeDetail, ForgeSearchItem } from '@gen/bindings'
import { ConfirmDialog } from '../shared/components/confirm-dialog'
import { commonText } from '../i18n/common-text'
import { registryText } from '../i18n/registry-text'
import {
  evaluateAddonParentConstraint,
  getAddonParentInfo,
} from '../data/registry-repository'
import { modListAtom } from '../state/library-state'
import { useAtomValue } from 'jotai'

export function RegistryParentDialog({
  addon,
  open,
  onOpenChange,
  onSearchParent,
}: {
  addon: ForgeSearchItem | ForgeDetail | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSearchParent: (parentName: string, parentId: number | null) => void
}) {
  const installedMods = useAtomValue(modListAtom)
  if (!addon) return null

  const { parentName, parentId, constraint } = getAddonParentInfo(addon)
  const parentStatus = evaluateAddonParentConstraint({ addon, installedMods })
  const description =
    parentStatus.status === 'mismatch'
      ? registryText.parentGateMismatch(
          parentName,
          constraint,
          parentStatus.installedVersion,
        )
      : parentStatus.status === 'unverified'
        ? registryText.parentGateUnverified(parentName)
        : registryText.parentGateMissing(parentName, constraint)

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={registryText.parentGateTitle()}
      description={description}
      confirmLabel={registryText.parentGateSearch()}
      cancelLabel={commonText.cancel()}
      onConfirm={() => {
        onSearchParent(parentName, parentId)
        onOpenChange(false)
      }}
    />
  )
}
