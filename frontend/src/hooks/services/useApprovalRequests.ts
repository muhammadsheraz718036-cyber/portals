import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/constants/query-keys";
import { services } from "../../services";
import { toast } from "sonner";
import {
  CreateApprovalRequestRequest,
  UpdateApprovalRequestRequest,
  ApprovalActionRequest,
  RejectApprovalActionRequest,
} from "../../services/types";

export const useApprovalRequests = () => {
  return useQuery({
    queryKey: [QUERY_KEYS.APPROVAL_REQUESTS],
    queryFn: () => services.approvalRequests.list(),
    staleTime: 15 * 1000,
    refetchInterval: 15 * 1000,
  });
};

export const useApprovalRequest = (id: string) => {
  return useQuery({
    queryKey: QUERY_KEYS.REQUEST_DETAIL(id),
    queryFn: () => services.approvalRequests.get(id),
    enabled: !!id,
    staleTime: 1 * 60 * 1000,
  });
};

export const useCreateApprovalRequest = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateApprovalRequestRequest) =>
      services.approvalRequests.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.APPROVAL_REQUESTS] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.NOTIFICATIONS] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create request");
    },
  });
};

export const useWorkAssignees = (departmentId?: string | null) => {
  return useQuery({
    queryKey: ["work-assignees", departmentId === null ? "all" : (departmentId ?? "default")],
    queryFn: () => services.approvalRequests.listAssignees(departmentId),
    staleTime: 10 * 60 * 1000,
  });
};

export const useUpdateApprovalRequest = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateApprovalRequestRequest }) =>
      services.approvalRequests.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.APPROVAL_REQUESTS] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.REQUEST_DETAIL(id) });
      toast.success("Request updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update request");
    },
  });
};

export const useDeleteApprovalRequest = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => services.approvalRequests.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.APPROVAL_REQUESTS] });
      queryClient.removeQueries({ queryKey: QUERY_KEYS.REQUEST_DETAIL(id) });
      toast.success("Request deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete request");
    },
  });
};

export const useApproveRequest = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: ApprovalActionRequest }) =>
      services.approvalRequests.approve(id, data || {}),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.APPROVAL_REQUESTS] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.REQUEST_DETAIL(id) });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.NOTIFICATIONS] });
      toast.success("Request approved successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to approve request");
    },
  });
};

export const useRejectRequest = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: RejectApprovalActionRequest }) =>
      services.approvalRequests.reject(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.APPROVAL_REQUESTS] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.REQUEST_DETAIL(id) });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.NOTIFICATIONS] });
      toast.success("Request rejected successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to reject request");
    },
  });
};

export const useAssignWorkRequest = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, assigneeId }: { id: string; assigneeId: string }) =>
      services.approvalRequests.assignWork(id, assigneeId),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.APPROVAL_REQUESTS] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.REQUEST_DETAIL(id) });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.NOTIFICATIONS] });
      toast.success("Work assignee updated");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to assign approved work");
    },
  });
};

export const useUpdateWorkStatusRequest = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: ApprovalActionRequest & {
        status: "pending" | "assigned" | "in_progress" | "done";
      };
    }) => services.approvalRequests.updateWorkStatus(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.APPROVAL_REQUESTS] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.REQUEST_DETAIL(id) });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.NOTIFICATIONS] });
      toast.success("Work status updated");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update work status");
    },
  });
};

export const useResolveRequestNumber = () => {
  return useMutation({
    mutationFn: (requestNumber: string) =>
      services.approvalRequests.resolveRequestNumber(requestNumber),
  });
};
