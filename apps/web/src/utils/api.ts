import "client-only"
import axios, { AxiosError, AxiosRequestConfig } from "axios";
import { useRefreshToken } from "../service/useUser";
import { clearSession } from "../actions/auth";
import { redirect } from "next/navigation";

const api = axios.create({ baseURL: "/api" });

//del

export default api;
