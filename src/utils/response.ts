export interface SuccessResponse<T> {
  err: 200;
  data: T;
}

export interface ErrorResponse {
  err: number;
  message: string;
}

export const successResponse = <T>(data: T): SuccessResponse<T> => ({
  err: 200,
  data,
});

export const errorResponse = (statusCode: number, message: string): ErrorResponse => ({
  err: statusCode,
  message,
});
