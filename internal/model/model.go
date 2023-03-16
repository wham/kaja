package model

type Model struct {
	Files []File
}

func (model *Model) GetMethod(serviceName, methodName string) (File, Service, Method) {
	var file File
	var service Service
	var method Method

	out:
	for _, f := range model.Files {
		for _, s := range f.Services {
			if s.Name == serviceName {
				file = f
				service = s
				break out
			}
		}
	}

	for _, m := range service.Methods {
		if m.Name == methodName {
			method = m
			break
		}
	}

	return file, service, method
}

func (model *Model) GetFirstMethod() (File, Service, Method) {
	var file File
	var service Service
	var method Method
	
	out:
	for _, f := range model.Files {
		for _, s := range f.Services {
			for _, m := range s.Methods {
				file = f
				service = s
				method = m
				break out
			}
		}
	}

	return file, service, method
}

type File struct {
	Path string
	Package string
	Services []Service
}

type Service struct {
	Name  string
	Methods []Method
}

type Method struct {
	Name string
	Input  Message
}

type Message struct {
	Fields []Field
}

type Field struct {
	Name string
	Kind string
	Input Input
	Parse Parse
	DefaultValue string
	Enums map[string]string
}
