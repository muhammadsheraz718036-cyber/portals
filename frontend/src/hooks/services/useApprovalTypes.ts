import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { services } from "../../services";
import { useAuth } from "@/contexts/auth-hooks";
import { toast } from "sonner";
import {
  CreateApprovalTypeRequest,
  UpdateApprovalTypeRequest,
  CreateApprovalTypeAttachmentRequest,
  UpdateApprovalTypeAttachmentRequest,
} from "../../services/types";

export const useApprovalTypes = (departmentId?: string) => {
  const { hasPermission } = useAuth();

  return useQuery({
    queryKey: ["approval-types", departmentId || "all"],
    queryFn: () => services.approvalTypes.list(departmentId),
    enabled:
      hasPermission("manage_approval_types") ||
      hasPermission("initiate_request"),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

export const useApprovalType = (id: string) => {
  const { hasPermission } = useAuth();

  return useQuery({
    queryKey: ["approval-types", id],
    queryFn: () => services.approvalTypes.get(id),
    enabled: !!id && hasPermission("manage_approval_types"),
  });
};

export const useCreateApprovalType = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();

  return useMutation({
    mutationFn: (data: CreateApprovalTypeRequest) => {
      if (!hasPermission("manage_approval_types")) {
        throw new Error("You do not have permission to manage approval types");
      }
      return services.approvalTypes.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approval-types"] });
      toast.success("Approval type created successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create approval type");
    },
  });
};

export const useUpdateApprovalType = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: UpdateApprovalTypeRequest;
    }) => {
      if (!hasPermission("manage_approval_types")) {
        throw new Error("You do not have permission to manage approval types");
      }
      return services.approvalTypes.update(id, data);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["approval-types"] });
      queryClient.invalidateQueries({ queryKey: ["approval-types", id] });
      toast.success("Approval type updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update approval type");
    },
  });
};

export const useDeleteApprovalType = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();

  return useMutation({
    mutationFn: (id: string) => {
      if (!hasPermission("manage_approval_types")) {
        throw new Error("You do not have permission to manage approval types");
      }
      return services.approvalTypes.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approval-types"] });
      toast.success("Approval type deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete approval type");
    },
  });
};

// Attachment hooks
export const useApprovalTypeAttachments = (approvalTypeId: string) => {
  const { hasPermission } = useAuth();

  return useQuery({
    queryKey: ["approval-types", approvalTypeId, "attachments"],
    queryFn: () => services.approvalTypes.getAttachments(approvalTypeId),
    enabled:
      !!approvalTypeId &&
      (hasPermission("manage_approval_types") ||
        hasPermission("initiate_request")),
  });
};

export const useCreateApprovalTypeAttachment = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();

  return useMutation({
    mutationFn: ({
      approvalTypeId,
      data,
    }: {
      approvalTypeId: string;
      data: CreateApprovalTypeAttachmentRequest;
    }) => {
      if (!hasPermission("manage_approval_types")) {
        throw new Error("You do not have permission to manage approval types");
      }
      return services.approvalTypes.createAttachment(approvalTypeId, data);
    },
    onSuccess: (_, { approvalTypeId }) => {
      queryClient.invalidateQueries({
        queryKey: ["approval-types", approvalTypeId, "attachments"],
      });
      queryClient.invalidateQueries({ queryKey: ["approval-types"] });
      toast.success("Attachment created successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create attachment");
    },
  });
};

export const useUpdateApprovalTypeAttachment = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();

  return useMutation({
    mutationFn: ({
      approvalTypeId,
      attachmentId,
      data,
    }: {
      approvalTypeId: string;
      attachmentId: string;
      data: UpdateApprovalTypeAttachmentRequest;
    }) => {
      if (!hasPermission("manage_approval_types")) {
        throw new Error("You do not have permission to manage approval types");
      }
      return services.approvalTypes.updateAttachment(
        approvalTypeId,
        attachmentId,
        data,
      );
    },
    onSuccess: (_, { approvalTypeId }) => {
      queryClient.invalidateQueries({
        queryKey: ["approval-types", approvalTypeId, "attachments"],
      });
      queryClient.invalidateQueries({ queryKey: ["approval-types"] });
      toast.success("Attachment updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update attachment");
    },
  });
};

export const useDeleteApprovalTypeAttachment = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();

  return useMutation({
    mutationFn: ({
      approvalTypeId,
      attachmentId,
    }: {
      approvalTypeId: string;
      attachmentId: string;
    }) => {
      if (!hasPermission("manage_approval_types")) {
        throw new Error("You do not have permission to manage approval types");
      }
      return services.approvalTypes.deleteAttachment(
        approvalTypeId,
        attachmentId,
      );
    },
    onSuccess: (_, { approvalTypeId }) => {
      queryClient.invalidateQueries({
        queryKey: ["approval-types", approvalTypeId, "attachments"],
      });
      queryClient.invalidateQueries({ queryKey: ["approval-types"] });
      toast.success("Attachment deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete attachment");
    },
  });
};
