package models

type DeploymentMethod string

const (
	DeploymentMethodCopyFirst DeploymentMethod = "copy-first"
	DeploymentMethodCopy      DeploymentMethod = "copy"
	DeploymentMethodLink      DeploymentMethod = "link"
)

func (m DeploymentMethod) Valid() bool {
	switch m {
	case DeploymentMethodCopyFirst, DeploymentMethodCopy, DeploymentMethodLink:
		return true
	default:
		return false
	}
}
