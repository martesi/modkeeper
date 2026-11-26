package models

type TargetRuntime string

const (
	TargetWindows TargetRuntime = "windows"
	TargetLinux   TargetRuntime = "linux"
)

type DeploymentPolicy struct {
	TargetRuntime    TargetRuntime    `json:"targetRuntime"`
	DeploymentMethod DeploymentMethod `json:"deploymentMethod"`
}

func (p DeploymentPolicy) Valid() bool {
	target, err := NormalizeTargetRuntime(p.TargetRuntime)
	return err == nil && p.TargetRuntime != "" && target == p.TargetRuntime && p.DeploymentMethod.Valid()
}

func NormalizeTargetRuntime(runtime TargetRuntime) (TargetRuntime, error) {
	switch runtime {
	case "", TargetWindows:
		return TargetWindows, nil
	case TargetLinux:
		return TargetLinux, nil
	default:
		return "", Fail(ParseError, "invalid target runtime")
	}
}

type SetDeploymentPolicyInput struct {
	LibraryID        string           `json:"libraryId"`
	TargetRuntime    TargetRuntime    `json:"targetRuntime"`
	DeploymentMethod DeploymentMethod `json:"deploymentMethod"`
}
